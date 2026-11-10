// Manual desktop fixture: creates a new isolated repository, never resets an existing one.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";

const parent = resolve("research"); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, "remote-merge-"));
const git = (...args) => { const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); };
const write = (path, value) => { const destination = join(root, path); mkdirSync(resolve(destination, ".."), { recursive: true }); writeFileSync(destination, value); };
function png(color) {
  const crc = bytes => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; };
  const chunk = (kind, data) => { const body = Buffer.concat([Buffer.from(kind), data]); const length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((64 * 3 + 1) * 64); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) color.forEach((value, c) => { raw[y * 193 + 1 + x * 3 + c] = value; });
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
git("init", "-b", "main"); git("config", "user.name", "协作测试"); git("config", "user.email", "merge@example.invalid"); git("config", "core.autocrlf", "false");
git("remote", "add", "origin", "https://github.com/example/hakurou-review.git"); git("config", "branch.main.remote", "origin"); git("config", "branch.main.merge", "refs/heads/main");
const base = `# 远程合并演示

这篇稿件用于验证本地与远程共同写作。

## 研究方法

方法：共同版本的初始方案。

## 结果

结果：共同版本的数据。

| 项目 | 数值 |
| --- | ---: |
| 样本 | 12 |

$$
E = mc^2
$$

![协作示意图](./assets/demo/figure.png)

## 协作记录

原始协作记录。
`;
const sidecar = { schemaVersion: 1, document: { schemaVersion: 1, documentId: "bb31be0e-25a1-4db5-b55d-e0339588f786", kind: "markdown" }, assets: [{ schemaVersion: 1, assetId: "efc0bc39-632f-41d3-a59a-a17bbc891834", kind: "image", source: { format: "png", path: "./assets/demo/figure.png", mimeType: "image/png" } }], format: { version: 1, defaults: {}, text: [], tables: [] } };
write("paper.md", base); write("assets/demo/figure.png", png([130,145,130])); write("assets/demo/hakurou.json", JSON.stringify(sidecar) + "\n"); git("add", "-A"); git("commit", "-m", "共同初稿"); const common = git("rev-parse", "HEAD"); git("branch", "collaborator");
write("paper.md", base.replace("方法：共同版本的初始方案。", "方法：本地采用方案 A。").replace("原始协作记录。", "本地新增的协作说明。")); git("commit", "-am", "本地修改研究方法与协作说明");
sidecar.format.defaults = { font: { preset: "modern", weight: 400 } }; write("assets/demo/hakurou.json", JSON.stringify(sidecar) + "\n"); git("commit", "-am", "本地调整文稿字体");
write("assets/demo/figure.png", png([165,83,70])); git("commit", "-am", "本地更新示意图"); const local = git("rev-parse", "HEAD");
git("checkout", "collaborator");
write("paper.md", base.replace("方法：共同版本的初始方案。", "方法：远程采用方案 B。").replace("结果：共同版本的数据。", "结果：远程补充了验证数据。")); write("协作补充.md", "# 协作补充\n\n远程新增的实验说明。\n"); git("add", "-A"); git("commit", "-m", "远程修改研究方法并补充结果");
sidecar.format.defaults = { tableStyle: "three-line" }; write("assets/demo/hakurou.json", JSON.stringify(sidecar) + "\n"); write("assets/demo/figure.png", png([70,112,165])); git("commit", "-am", "远程调整表格并更新示意图"); const remote = git("rev-parse", "HEAD");
git("update-ref", "refs/remotes/origin/main", remote); git("checkout", "main");
const baseline = { root, documentPath: join(root, "paper.md"), common, local, remote };
writeFileSync(root + "-baseline.json", JSON.stringify(baseline, null, 2));
console.log(JSON.stringify(baseline, null, 2));
