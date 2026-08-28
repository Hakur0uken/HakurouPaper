#!/usr/bin/env python3
"""Batch-convert Word OMML equations to MathType OLE objects.

Focused adaptation of MathTypeOfficialBridge from Piperange/word-mathtype-mcp
(MIT). It drives MathType's Word add-in conversion and formatting dialogs.
It is deliberately a local desktop workflow: do not run it as a service.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
import types
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit_status(phase: str) -> None:
    """Send a line-delimited progress event back to the desktop app."""

    print(json.dumps({"event": "status", "phase": phase}, ensure_ascii=False), flush=True)


def configure_comtypes_cache(cache_dir: Path) -> None:
    """Keep generated COM wrappers inside the export work directory."""

    import comtypes

    cache_dir.mkdir(parents=True, exist_ok=True)
    generated = types.ModuleType("comtypes.gen")
    generated.__path__ = [str(cache_dir)]
    sys.modules["comtypes.gen"] = generated
    comtypes.gen = generated


def call_with_retry(action, attempts: int = 5, delay: float = 0.2):
    last_error = None
    for _ in range(attempts):
        try:
            return action()
        except Exception as error:
            last_error = error
            time.sleep(delay)
    raise last_error or RuntimeError("Desktop automation failed.")


def normalize_ui_text(value: object) -> str:
    return " ".join(str(value or "").split()).lower()


def text_matches(value: object, patterns: tuple[str, ...]) -> bool:
    normalized = normalize_ui_text(value)
    return any(normalize_ui_text(pattern) in normalized for pattern in patterns)


class ConversionCompletedWhileWaiting(Exception):
    """The document proves conversion completed before UIA saw the dialog."""


class ManualStepCompletedWhileWaiting(Exception):
    """The user explicitly confirmed a MathType dialog was completed."""


class DialogWorker(threading.Thread):
    def __init__(self, handler) -> None:
        super().__init__(daemon=True)
        self.handler = handler
        self.result = ""
        self.error: Exception | None = None

    def run(self) -> None:
        import comtypes
        import pythoncom

        pythoncom.CoInitialize()
        comtypes.CoInitialize()
        try:
            self.result = str(self.handler() or "")
        except Exception as error:
            self.error = error
        finally:
            comtypes.CoUninitialize()
            pythoncom.CoUninitialize()

    def wait(self, timeout_seconds: float = 120.0) -> str:
        self.join(timeout_seconds)
        if self.is_alive():
            raise TimeoutError("Timed out waiting for the MathType dialog.")
        if self.error is not None:
            raise self.error
        return self.result


class MathTypeOfficialBatch:
    convert_macro = "MathTypeCommands.UILib.MTCommand_ConvertEqns"
    format_macro = "MathTypeCommands.UILib.MTCommand_FormatEqns"

    def __init__(self, manual_continue_file: Path | None = None) -> None:
        self.conversion_completed: threading.Event | None = None
        self.convert_dialog_seen: threading.Event | None = None
        self.manual_conversion_pending: threading.Event | None = None
        self.manual_continue_file = manual_continue_file
        self.word_process_id: int | None = None

    def take_manual_continue_request(self) -> bool:
        """Consume the desktop app's explicit user-completion signal."""

        path = self.manual_continue_file
        if path is None or not path.is_file():
            return False
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        return True

    def open_word(self):
        import pythoncom
        import win32com.client as win32

        pythoncom.CoInitialize()
        word = win32.DispatchEx("Word.Application")
        word.Visible = True
        word.DisplayAlerts = 0
        return pythoncom, word

    def wait_for_addin(self, document, timeout_seconds: float = 30.0) -> None:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            try:
                count = int(call_with_retry(lambda: document.Application.AddIns.Count))
                for index in range(1, count + 1):
                    addin = call_with_retry(lambda current=index: document.Application.AddIns(current))
                    name = str(call_with_retry(lambda: addin.Name) or "")
                    installed = bool(call_with_retry(lambda: addin.Installed))
                    if installed and "mathtype" in name.lower():
                        return
            except Exception:
                pass
            time.sleep(0.5)
        raise RuntimeError("MathType Word add-in is not loaded.")

    def focus_document(self, document) -> None:
        try:
            import win32con
            import win32gui

            hwnd = int(call_with_retry(lambda: document.ActiveWindow.Hwnd))
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            pass

    def attach_to_word_process(self, document) -> None:
        """Record the exact Word process hosting this export document."""

        try:
            import win32process

            hwnd = int(call_with_retry(lambda: document.ActiveWindow.Hwnd))
            _, self.word_process_id = win32process.GetWindowThreadProcessId(hwnd)
        except Exception:
            self.word_process_id = None

    def windows(self):
        from pywinauto import Desktop

        try:
            return Desktop(backend="uia").windows()
        except Exception:
            return []

    @staticmethod
    def is_word_or_mathtype_process(window) -> bool:
        """Limit descendant scanning to the Word/MathType processes only."""

        try:
            import win32api
            import win32con
            import win32process

            process_id = int(window.element_info.process_id)
            handle = win32api.OpenProcess(
                win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ,
                False,
                process_id,
            )
            try:
                executable = win32process.GetModuleFileNameEx(handle, 0)
            finally:
                handle.Close()
            name = os.path.basename(executable).lower()
            return name == "winword.exe" or "mathtype" in name
        except Exception:
            # Word's document host uses the OpusApp class.  Keep a narrow
            # fallback for installations where querying the process image is
            # denied, while still excluding Chromium/Edge windows.
            try:
                class_name = str(window.element_info.class_name or "").lower()
                return "opusapp" in class_name or "mathtype" in class_name
            except Exception:
                return False

    @staticmethod
    def is_exact_dialog_title(title: object, patterns: tuple[str, ...]) -> bool:
        """Match a real dialog title without accepting a browser-tab sentence."""

        compact = re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", normalize_ui_text(title))
        compact_without_mathtype = compact.replace("mathtype", "")
        for pattern in patterns:
            expected = re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", normalize_ui_text(pattern))
            if compact == expected or compact_without_mathtype == expected:
                return True
        return False

    def window_text(self, window) -> str:
        values: list[str] = []
        for current in [window, *window.descendants()]:
            try:
                value = current.window_text()
            except Exception:
                continue
            if value:
                values.append(str(value))
        return "\n".join(values)

    def find_window(
        self,
        patterns: tuple[str, ...],
        extra: tuple[str, ...] = (),
        dialog_markers: tuple[str, ...] = (),
    ):
        """Find a top-level MathType dialog, never a similarly named tab/control.

        The earlier implementation searched every descendant and could mistake a
        browser tab named “MathType 转换公式 …” for the real converter window.
        Only a top-level window title may identify a MathType dialog.
        """

        candidates = []
        for root in self.windows():
            try:
                root_process_id = int(root.element_info.process_id)
            except Exception:
                continue
            if self.word_process_id is not None:
                # Do not ask Windows for the executable image here: that
                # query is commonly denied under normal desktop permissions,
                # which previously made real Word dialogs invisible to us.
                if root_process_id != self.word_process_id:
                    continue
            elif not self.is_word_or_mathtype_process(root):
                continue
            # MathType's legacy Word add-in often hosts its modal UI as a
            # descendant of the document window rather than a separate
            # top-level window.  Search those descendants, but never another
            # application's descendants (the original source of the Edge-tab
            # false positive).
            for current in [root, *root.descendants()]:
                try:
                    title = current.window_text()
                except Exception:
                    continue
                content = self.window_text(current)
                title_matches = self.is_exact_dialog_title(title, patterns)
                # Word sometimes exposes a MathType modal as a child Window
                # with a blank or slightly different UIA title.  Its controls
                # are stable enough to be a safe fallback identifier.
                marker_matches = bool(dialog_markers) and text_matches(
                    content,
                    dialog_markers,
                )
                if not title_matches and not marker_matches:
                    continue
                if extra and not text_matches(content, extra):
                    continue
                candidates.append(current)
        if not candidates:
            return None
        return max(candidates, key=lambda current: len(current.descendants()))

    def wait_for_window(
        self,
        patterns: tuple[str, ...],
        extra: tuple[str, ...] = (),
        timeout_seconds: float = 30.0,
        manual_nudge_after_seconds: float | None = None,
        manual_nudge_phase: str | None = None,
        dialog_markers: tuple[str, ...] = (),
    ):
        deadline = time.time() + timeout_seconds
        manual_nudge_sent = False
        while time.time() < deadline:
            if self.conversion_completed is not None and self.conversion_completed.is_set():
                raise ConversionCompletedWhileWaiting()
            if self.take_manual_continue_request():
                raise ManualStepCompletedWhileWaiting()
            dialog = self.find_window(patterns, extra, dialog_markers)
            if dialog is not None:
                return dialog
            if (
                manual_nudge_after_seconds is not None
                and not manual_nudge_sent
                and time.time() >= deadline - timeout_seconds + manual_nudge_after_seconds
            ):
                if manual_nudge_phase is not None:
                    emit_status(manual_nudge_phase)
                manual_nudge_sent = True
            time.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for MathType dialog: {patterns}")

    def control(self, window, control_types: tuple[str, ...], patterns: tuple[str, ...]):
        fallback = []
        for current in [window, *window.descendants()]:
            try:
                if text_matches(current.window_text(), patterns):
                    control_type = str(current.element_info.control_type or "")
                    if not control_types or control_type in control_types:
                        return current
                    # MathType's legacy dialogs occasionally expose interactive
                    # controls as Pane/Custom instead of UIA's expected type.
                    fallback.append(current)
            except Exception:
                continue
        if fallback:
            return fallback[0]
        raise LookupError(
            f"Unable to find MathType dialog control: {patterns}. "
            f"Visible controls: {self.describe_controls(window)}"
        )

    @staticmethod
    def describe_controls(window) -> str:
        entries = []
        for current in [window, *window.descendants()]:
            try:
                title = (current.window_text() or "").strip()
                control_type = str(current.element_info.control_type or "")
                if title:
                    entries.append(f"{control_type}:{title}")
            except Exception:
                continue
        return " | ".join(entries[:80])

    @staticmethod
    def click(control) -> None:
        for name in ("invoke", "click_input", "click"):
            action = getattr(control, name, None)
            if action is None:
                continue
            try:
                action()
                return
            except Exception:
                continue
        raise RuntimeError("Unable to click MathType dialog control.")

    def radio(self, window, patterns: tuple[str, ...]) -> None:
        control = self.control(window, ("RadioButton",), patterns)
        try:
            if int(control.get_toggle_state()) == 1:
                return
        except Exception:
            pass
        select = getattr(control, "select", None)
        if select is not None:
            try:
                select()
                return
            except Exception:
                pass
        self.click(control)

    def optional_radio(self, window, patterns: tuple[str, ...]) -> bool:
        try:
            self.radio(window, patterns)
            return True
        except LookupError:
            return False

    def checkbox(self, window, patterns: tuple[str, ...], checked: bool) -> None:
        control = self.control(window, ("CheckBox",), patterns)
        try:
            if (int(control.get_toggle_state()) == 1) == checked:
                return
        except Exception:
            pass
        toggle = getattr(control, "toggle", None)
        if toggle is not None:
            try:
                toggle()
                return
            except Exception:
                pass
        self.click(control)

    def button(self, window, patterns: tuple[str, ...]) -> None:
        self.click(self.control(window, ("Button",), patterns))

    def dismiss_summary(self, patterns: tuple[str, ...], extra: tuple[str, ...]) -> str:
        try:
            dialog = self.wait_for_window(patterns, extra=extra, timeout_seconds=120.0)
        except ConversionCompletedWhileWaiting:
            return "MathType macro completed before its summary dialog was observed"
        except (ManualStepCompletedWhileWaiting, TimeoutError):
            # The summary is informative.  Formula conversion is verified by
            # the document itself and must not fail only because a short-lived
            # summary was dismissed before UIA observed it.
            return "MathType summary dialog was not observed"
        summary = self.window_text(dialog)
        try:
            self.button(dialog, ("确定", "ok"))
        except LookupError:
            # The conversion summary in older MathType releases is sometimes a
            # custom window with no UIA Button child. Enter is its default OK.
            type_keys = getattr(dialog, "type_keys", None)
            if type_keys is None:
                raise
            type_keys("{ENTER}")
        return summary

    def wait_for_window_to_close(
        self,
        patterns: tuple[str, ...],
        timeout_seconds: float = 180.0,
        dialog_markers: tuple[str, ...] = (),
    ) -> str:
        """Wait for an already-observed legacy dialog to be dismissed."""

        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self.take_manual_continue_request():
                return "manual dialog completion confirmed"
            if self.find_window(patterns, dialog_markers=dialog_markers) is None:
                return "dialog dismissed"
            time.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for MathType dialog to close: {patterns}")

    def convert_dialog(self) -> str:
        emit_status("mathtypeAwaitingConvertDialog")
        try:
            dialog = self.wait_for_window(
                ("转换公式", "convert equations"),
                timeout_seconds=90.0,
                manual_nudge_after_seconds=20.0,
                manual_nudge_phase="mathtypeManualConvertNeeded",
                dialog_markers=("word 2007", "omml", "office math"),
            )
        except ConversionCompletedWhileWaiting:
            # The user may have manually clicked Convert before UI Automation
            # observed the short-lived dialog.  The caller verifies actual
            # OMML → MathType replacement before deciding success.
            emit_status("mathtypeBatchConverting")
            return "conversion dialog completed manually"
        except ManualStepCompletedWhileWaiting:
            emit_status("mathtypeBatchConverting")
            return "manual conversion completion confirmed"
        if self.convert_dialog_seen is not None:
            self.convert_dialog_seen.set()
        emit_status("mathtypeConvertDialogReady")
        # Do not depend on Word's selection: MathType's "current selection"
        # path may ignore Word's Content.Select() for OMML equations.
        try:
            self.radio(dialog, ("whole document", "整篇文档", "整个文档", "全文"))
            # Do not select a control merely because it mentions MathType.
            # In several MathType versions that label is an *input-family*
            # selector, not an output-format selector.  Selecting it after
            # the document range can silently deselect the Word-2007/OMML
            # source and yield the misleading “no equations found” summary.
            # The Convert Equations command already creates MathType OLE
            # objects; the only source family we need to enable is OMML.
            self.checkbox(dialog, ("mathtype 或 equation editor", "mathtype or equation editor"), False)
            self.checkbox(
                dialog,
                ("word 2007", "word 2007 及更高版本", "word 2007 和更高版本", "omml", "office math"),
                True,
            )
            self.checkbox(dialog, ("word eq", "eq 域"), False)
            self.checkbox(dialog, ("文本公式", "text equations"), False)
            self.checkbox(dialog, ("给出提示", "prompt before"), False)
            # Some releases rebuild the dialog after a source checkbox is
            # toggled.  Select the range last so the final state is always the
            # full document, never Word's transient selection.
            self.radio(dialog, ("whole document", "整篇文档", "整个文档", "全文"))
            self.button(dialog, ("转换", "convert"))
            emit_status("mathtypeBatchConverting")
            # Both a successful and an empty conversion use a localized
            # informational summary.  Its stable discriminator is the OK
            # button, whereas the old English-only “updated” marker caused
            # the worker to wait two extra minutes after Word had finished.
            return self.dismiss_summary(("转换公式", "convert equations"), ("确定", "ok"))
        except (LookupError, RuntimeError):
            # The dialog can vary between MathType/Office language versions or
            # be manually advanced before UI Automation sees its controls.
            # Do not turn an already successful manual conversion into an
            # export failure. Application.Run remains blocked until the user
            # clicks Convert (or cancels); convert_document validates the
            # resulting document before it is saved.
            emit_status("mathtypeManualConvertNeeded")
            if self.manual_conversion_pending is not None:
                self.manual_conversion_pending.set()
            return self.wait_for_manual_confirmation("conversion")

    def format_dialog(self) -> str:
        emit_status("mathtypeAwaitingFormatDialog")
        try:
            # The format window can arrive noticeably later than the convert
            # window on a document that has just had many OMaths replaced.
            # A 30-second wait made a correctly completed formatting pass look
            # like an export failure simply because its UI was late.
            dialog = self.wait_for_window(
                ("格式化公式", "format equations"),
                timeout_seconds=180.0,
                manual_nudge_after_seconds=30.0,
                manual_nudge_phase="mathtypeManualFormatNeeded",
                dialog_markers=(
                    "格式化公式使用预置从",
                    "mathtype 新的公式预置",
                    "mathtype new equation preferences",
                ),
            )
        except ConversionCompletedWhileWaiting:
            return "format dialog completed before automation observed it"
        except ManualStepCompletedWhileWaiting:
            return "manual format completion confirmed"
        except TimeoutError:
            # Formatting is a preference pass after native MathType OLE
            # conversion.  A missed/nonexistent dialog must never block saving
            # the already converted document.
            emit_status("mathtypeFormattingSkipped")
            return "format dialog was not observed; preserving converted equations"
        emit_status("mathtypeFormatDialogReady")
        try:
            # Content.Select() is still active here, so "current selection"
            # in this dialog already means the complete document.  Prefer the
            # explicit whole-document option when this MathType release exposes
            # it, but do not require it in order to continue.
            self.optional_radio(dialog, ("whole document", "整篇文档", "整个文档", "全文"))
            self.radio(dialog, ("new equation", "新的公式预置"))
            try:
                self.button(dialog, ("确定", "!0002ok", "ok"))
            except (LookupError, RuntimeError):
                # This dialog defaults to Confirm.  Some MathType builds map
                # it as a custom control rather than a UIA Button.
                focus = getattr(dialog, "set_focus", None)
                type_keys = getattr(dialog, "type_keys", None)
                if focus is None or type_keys is None:
                    raise
                focus()
                type_keys("{ENTER}")
            return self.wait_for_window_to_close(
                ("格式化公式", "format equations"),
                dialog_markers=("格式化公式使用预置从", "mathtype 新的公式预置"),
            )
        except (LookupError, RuntimeError):
            # Formatting is a post-conversion preference pass.  It must not
            # invalidate successful MathType OLE conversion just because a
            # localized legacy dialog exposes controls differently.  Let the
            # user press OK; observing the dialog close then releases the
            # worker and saving continues normally.
            emit_status("mathtypeManualFormatNeeded")
            return self.wait_for_manual_confirmation("formatting")

    def wait_for_manual_confirmation(self, step: str) -> str:
        deadline = time.time() + 600.0
        while time.time() < deadline:
            if self.conversion_completed is not None and self.conversion_completed.is_set():
                return f"manual {step} completed"
            if self.take_manual_continue_request():
                return f"manual {step} completion confirmed"
            time.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for manual MathType {step} confirmation.")

    def run_macro(self, document, name: str, handler, conversion_complete=None) -> tuple[str, bool]:
        self.conversion_completed = threading.Event()
        self.convert_dialog_seen = threading.Event()
        self.manual_conversion_pending = threading.Event()
        worker = DialogWorker(handler)
        worker.start()
        time.sleep(0.5)
        macro_started = time.monotonic()
        try:
            call_with_retry(lambda: document.Application.Run(name), attempts=3, delay=0.5)
        except Exception as error:
            self.conversion_completed.set()
            try:
                worker.wait(timeout_seconds=5.0)
            except Exception:
                pass
            raise RuntimeError(f"MathType macro failed: {name}") from error
        macro_elapsed = time.monotonic() - macro_started
        # On this MathType/Word combination Application.Run blocks while the
        # Convert dialog is in use.  If it returns after a real user-visible
        # pause but UI Automation never saw the dialog (or explicitly handed
        # control to the user), the user has completed the action manually.
        # Treat that as a valid completion signal and still prefer structural
        # document checks whenever they are available.
        manual_macro_completion = (
            conversion_complete is not None
            and macro_elapsed >= 1.5
            and (
                not self.convert_dialog_seen.is_set()
                or self.manual_conversion_pending.is_set()
            )
        )
        if manual_macro_completion:
            self.conversion_completed.set()
        try:
            deadline = time.time() + 180.0
            while worker.is_alive() and time.time() < deadline:
                if conversion_complete is not None:
                    try:
                        complete = bool(conversion_complete())
                    except Exception:
                        complete = False
                    if complete:
                        self.conversion_completed.set()
                worker.join(0.2)
            if worker.is_alive():
                raise TimeoutError("Timed out waiting for MathType dialog.")
            return worker.wait(), manual_macro_completion
        finally:
            self.conversion_completed = None
            self.convert_dialog_seen = None
            self.manual_conversion_pending = None

    @staticmethod
    def equation_counts(document) -> dict[str, int]:
        office_math = 0
        mathtype = 0
        try:
            office_math = int(document.OMaths.Count)
        except Exception:
            pass
        try:
            shape_collections = (document.InlineShapes, document.Shapes)
            for shapes in shape_collections:
                for index in range(1, int(shapes.Count) + 1):
                    try:
                        prog_id = str(shapes(index).OLEFormat.ProgID or "")
                        if "equation.dsmt" in prog_id.lower():
                            mathtype += 1
                    except Exception:
                        continue
        except Exception:
            pass
        return {"officeMath": office_math, "mathType": mathtype}

    @staticmethod
    def conversion_finished(before: dict[str, int], after: dict[str, int]) -> bool:
        if before["officeMath"] == 0:
            return True
        return (
            after["officeMath"] == 0
            and after["mathType"] >= before["mathType"] + before["officeMath"]
        )

    def convert_document(self, docx_path: Path) -> dict[str, object]:
        pythoncom = word = document = None
        path = str(docx_path.resolve())
        try:
            pythoncom, word = self.open_word()
            document = call_with_retry(lambda: word.Documents.Open(path, ReadOnly=False, AddToRecentFiles=False, Visible=True), attempts=30, delay=0.5)
            call_with_retry(lambda: document.Activate(), attempts=10, delay=0.2)
            self.attach_to_word_process(document)
            self.wait_for_addin(document)
            self.focus_document(document)
            # The export document was just created by Pandoc, so establish a
            # reliable baseline for verifying the actual OMath -> OLE result.
            try:
                document.Saved = True
            except Exception:
                pass
            before_conversion = self.equation_counts(document)
            convert_summary, _manual_macro_completion = self.run_macro(
                document,
                self.convert_macro,
                self.convert_dialog,
                conversion_complete=lambda: self.conversion_finished(
                    before_conversion,
                    self.equation_counts(document),
                ),
            )
            after_conversion = self.equation_counts(document)
            # A dirty document only proves that MathType opened a dialog. The
            # manual Continue button releases UI waiting; neither may be used
            # as evidence that equations were actually converted.
            if not self.conversion_finished(before_conversion, after_conversion):
                raise RuntimeError(
                    "MathType did not convert the Word equations. "
                    f"Before: {before_conversion}; after: {after_conversion}. "
                    "Check that ‘Word 2007 及以上 (OMML) 公式’ and ‘整篇文档’ are selected, "
                    "then click 转换 and wait for MathType's completion prompt."
                )
            # Convert Equations already uses MathType's new-equation preset
            # when it creates the OLE objects.  MTCommand_FormatEqns is a
            # separate legacy macro that can remain blocked after its dialog
            # closes, so invoking it here only adds an unreliable second
            # dialog and does not improve formula fidelity.
            format_summary = "skipped: conversion applied MathType new-equation preset"
            emit_status("saving")
            call_with_retry(lambda: document.Save(), attempts=10, delay=0.5)
            return {
                "ok": True,
                "officialWorkflowUsed": True,
                "beforeConversion": before_conversion,
                "afterConversion": after_conversion,
                "convertDialogText": convert_summary,
                "formatDialogText": format_summary,
            }
        finally:
            try:
                if document is not None:
                    call_with_retry(lambda: document.Close(False), attempts=5, delay=0.2)
            finally:
                try:
                    if word is not None:
                        call_with_retry(lambda: word.Quit(), attempts=5, delay=0.2)
                finally:
                    if pythoncom is not None:
                        pythoncom.CoUninitialize()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx_path")
    parser.add_argument("--comtypes-cache", required=True)
    parser.add_argument("--manual-continue-file", required=True)
    args = parser.parse_args()
    try:
        configure_comtypes_cache(Path(args.comtypes_cache))
        result = MathTypeOfficialBatch(
            manual_continue_file=Path(args.manual_continue_file)
        ).convert_document(Path(args.docx_path))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        detail = str(error).strip() or type(error).__name__
        print(f"MathType batch conversion failed: {detail}", file=sys.stderr)
        print("Run this export from the interactive Hakurou desktop app, with Word and MathType installed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
