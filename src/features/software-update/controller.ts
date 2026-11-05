import type { SoftwareUpdate, SoftwareUpdateInfo, SoftwareUpdateService } from "../../platform/updateTypes";
export type UpdateProblem = "check" | "download" | "install" | "unsaved" | "busy" | "open";
export type UpdateState = {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "error";
  open: boolean; currentVersion: string; update: SoftwareUpdateInfo | null;
  downloaded: number; total?: number; problem?: UpdateProblem;
};
export const initialUpdateState: UpdateState = { phase: "idle", open: false, currentVersion: "", update: null, downloaded: 0 };

/** Serializes updater operations and rechecks document safety immediately before install. */
export class SoftwareUpdateController {
  private state: UpdateState = initialUpdateState;
  private listeners = new Set<() => void>();
  private update: SoftwareUpdate | null = null;
  private operation: "check" | "download" | "install" | null = null;
  private disposed = false;
  private notifyOnResult = true;
  constructor(private service: SoftwareUpdateService, private installationBlock: () => "unsaved" | "busy" | null) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<UpdateState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  dismiss = () => {
    if (this.state.phase === "installing") return;
    this.notifyOnResult = false;
    this.set({ open: false });
  };
  async check(manual: boolean) {
    if (this.disposed) return;
    if (manual) this.set({ open: true });
    if (this.operation || this.update) return;
    this.operation = "check";
    this.notifyOnResult = true;
    this.set({ phase: "checking", problem: undefined });
    try {
      const result = await this.service.check();
      if (this.disposed) { await result.update?.close(); return; }
      this.update = result.update;
      this.set({
        currentVersion: result.currentVersion,
        update: result.update ? { version: result.update.version, notes: result.update.notes, date: result.update.date, kind: result.update.kind } : null,
        phase: result.update ? "available" : "current",
        open: this.state.open || (this.notifyOnResult && Boolean(result.update)),
      });
    } catch { this.set({ phase: "error", problem: "check" }); }
    finally { this.operation = null; }
  }
  async download() {
    if (this.disposed || this.operation || !this.update || this.update.kind !== "in-app" || this.state.phase !== "available") return;
    this.operation = "download";
    this.set({ phase: "downloading", downloaded: 0, total: undefined, problem: undefined });
    try {
      await this.update.download((progress) => this.set(progress));
      this.set({ phase: "ready" });
    } catch {
      this.set({ phase: "available", downloaded: 0, total: undefined, problem: "download" });
    } finally {
      this.operation = null;
      if (this.disposed) void this.update?.close().catch(() => {});
    }
  }
  async install() {
    if (this.disposed || this.operation || !this.update || this.state.phase !== "ready") return;
    const blocked = this.installationBlock();
    if (blocked) { this.set({ open: true, problem: blocked }); return; }
    this.operation = "install";
    this.set({ open: true, phase: "installing", problem: undefined });
    try { await this.update.install(); }
    catch { this.set({ phase: "available", downloaded: 0, total: undefined, problem: "install" }); }
    finally { this.operation = null; }
  }
  async openReleasePage() {
    try { await this.service.openReleasePage(); }
    catch { this.set({ problem: "open" }); }
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
    if (!this.operation) void this.update?.close().catch(() => {});
  }
}
