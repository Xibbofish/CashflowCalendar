# 推送 GitHub 问题排查记录

> 目的：把首次 `git push` 遇到的环境 / 配置问题记清楚，方便后续优化。

## 仓库信息

- 远程仓库：`Xibbofish/CashflowCalendar`（私有）
- 默认远程分支：`main`；本地分支已从 `master` 改名为 `main`
- token：fine-grained PAT，写权限仅限本仓库（见 `.dsh/skills/github`）

## 问题 1：Git 目录所有权冲突（dubious ownership）

**现象**
```
fatal: detected dubious ownership in repository at 'D:/HZY/Coding/cashflow-calendar'
```
仓库属主是 `BUILTIN/Administrators`，当前用户是 `DESKTOP-QL5D8C2/JT`，Git 拒绝操作。

**原因**：仓库可能是以管理员/其他账号创建（例如提权的 IDE），导致所有者不匹配。

**优化方案（建议在你的机器上做）**：
```bash
git config --global --add safe.directory D:/HZY/Coding/cashflow-calendar
# 也可改为更稳妥的：直接以当前用户对目录设置正确的 ACL（takeown 等）
```
> 说明：本次为避免改动全局配置，临时用 `git -c safe.directory=...` 每次传入解决。

## 问题 2：网络访问 github.com 失败，需要代理

**现象**
```
fatal: unable to access 'https://github.com/...': Failed to connect to github.com port 443
```
本机直接 `github.com:443` **不可达**，但 `api.github.com:443` / `raw.githubusercontent.com:443` 可达。
Windows 系统代理已设置为 `127.0.0.1:7890`，但 git 直连时没走代理。

**优化方案**：让 git 走系统代理
```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
# 或不开代理时：git config --global --unset http.proxy
```

## 问题 3：Git 的 https 传输在受限沙箱里被拦（环境相关）

**现象**
```
error: cannot create standard input pipe for remote-https: Permission denied
```
这是 DSH 文件沙箱在 `workspace-write` 模式下禁止子进程创建 stdin 管道所致（git 的 `remote-https` 助手需要）。
本次通过升级沙箱权限（`danger-full-access`）放行。属运行环境约束，非代码问题；在你自己的终端里不会出现。

## 问题 4：GitHub 的 git 端点需要 Basic 认证，而非 Bearer

**现象**：用 `Authorization: Bearer <token>` 头推送时，git 回退到交互式要账号密码（`could not read Username`）。

**原因**：GitHub 的 smart HTTP 走 HTTP Basic 认证，PAT 需用 `x-access-token`（或用户名）作为 Basic 用户名、token 作为密码。

**优化方案（推荐，避免令牌明文）**：启用 [GitHub CLI](https://cli.github.com/) 并登录，之后 `gh auth login && git push` 即自动带凭据；或本地配置 credential helper 存凭据。直接用 URL 内嵌令牌时注意别打进日志/提交：
```
https://x-access-token:<TOKEN>@github.com/...
```
> 本次用 `http.extraHeader="Authorization: Basic <base64(x-access-token:<token>)>"` 在运行时传入，未落盘。

## 问题 5：本地 `master` vs 远程 `main` 分支名不一致

提交信息里保留了两段历史（`init: 现金流日历 v2` → `docs: 功能设计 + 工程设计文档`）。首次推送到已有占位提交（自动生成的 README）的仓库时，因历史无关联需要 `--force` 覆盖那个占位提交（本次已征得同意）。

本地分支已改名为 `main` 并关联上游。以后 `git push` 即可。

## 杂项（可选优化）

- 提交作者邮箱是 `jt@cashflow.local`（非 GitHub 邮箱），推送后提交不会关联到账号。建议在 GitHub → Settings → Emails 抄一个 `ID+username@users.noreply.github.com`，并执行：
  ```bash
  git config --local user.name "你的名字"
  git config --local user.email "你的GH-noreply邮箱"
  ```
- 本机未安装 `gh` CLI，若常与 GitHub 打交道建议 `winget install GitHub.cli`。
- 工程文档 `docs/工程设计.md` 写的技术选型是 Vite 6，实际 `package.json` 是 Vite 8，可顺手更新。