import ReactDOM from "react-dom/client";
import App from "./App";

// Suppress the WebView menu everywhere, including startup and popup surfaces.
// Keep the event propagating so the editor's own context menu still opens.
const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
document.addEventListener("contextmenu", preventNativeContextMenu, { capture: true });
import.meta.hot?.dispose(() => document.removeEventListener("contextmenu", preventNativeContextMenu, { capture: true }));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
