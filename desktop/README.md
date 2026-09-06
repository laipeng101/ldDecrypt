# ldDecrypt Desktop

`ldDecrypt Desktop` 是本仓库 fork 提供的 Windows Portable 入口，用于临时使用 Web 界面。原有源码、CLI 和 Web Server 文档仍见仓库根目录 [README](../readme.md)。

## 下载

1. 打开 [Latest Release](https://github.com/laipeng101/ldDecrypt/releases/latest)。
2. 在 Assets 中下载 `ldDecrypt-*-win-x64-portable.exe`。
3. 如需校验，下载同名 `.sha256` 文件。

Source code zip/tar.gz 是源码压缩包，不是 Windows 程序。

## 系统要求

- Windows 11 x64
- 本机已安装并可正常使用绿盾环境
- Desktop Portable 已包含所需运行时，无需单独安装 Node.js/npm

源码 / CLI 模式的 Node 要求见根 README。

## 使用方法

1. 双击下载的 Portable EXE。
2. 等待应用窗口打开。
3. 在窗口内的 Web UI 中上传解密或配置目录监听。
4. 使用完成后关闭窗口。

本工具不会绕过绿盾授权；目标文件仍需要在当前机器/账号的绿盾环境下具备读取权限。

## 生命周期

应用启用单实例锁。重复启动时会聚焦已有窗口。

```text
Electron Main
  ├─ BrowserWindow
  └─ UtilityProcess
       └─ ldDecrypt Core
```

正常关闭窗口时，Main 进程向 Core 发送 shutdown 请求并等待退出。应用不注册 Windows Service、不配置开机自启、不提供托盘常驻。

## 数据目录

ldDecrypt Core 运行数据位于：

```text
%APPDATA%\lddecrypt-desktop\runtime
```

该目录用于运行时产生的数据，不会把 uploads 或 decrypted 写到 EXE 旁边。Electron 和 Chromium 自身的 userData 可能还包含缓存等文件。

## 网络监听

Desktop 启动时会临时启动本机 Web Core。Core 只绑定 `127.0.0.1`，端口由操作系统分配，Electron 窗口加载该本地地址。Desktop 文档不使用固定端口。

## SHA256 校验

PowerShell 示例：

```powershell
Get-ChildItem .\ldDecrypt-*-win-x64-portable.exe |
  Get-FileHash -Algorithm SHA256
```

将输出的 SHA256 值与 Release 中对应 `.sha256` 文件比较。

## Windows 未签名提示

当前 EXE 尚未配置 Authenticode 代码签名。Windows 可能显示“未知发布者”或 SmartScreen 提示。请确认文件来自本仓库 Releases，并使用 SHA256 校验完整性。

## 开发模式

在仓库根目录安装依赖后，Core 源码模式使用 Node.js `>= 22`。Desktop 开发入口在 `desktop/package.json`：

```powershell
cd desktop
npm install
npm run start
npm run smoke
```

## 构建

构建 Windows x64 Portable：

```powershell
cd desktop
npm run dist:win
```

## Release

正式 Desktop Release 通过仓库的 Release workflow 发布。文档变更不需要创建新 Release，也不要为文档 PR 提升 Desktop 版本号。
