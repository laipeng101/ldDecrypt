# 天锐绿盾文件解密工具

基于 Node.js 的绿盾加密文件解密工具。利用本机已安装的绿盾客户端权限，读取加密文件并写出解密副本。提供 Web 界面、REST API、目录监控与命令行多种交互方式。

- 包名：`@zlhy7/ld-decrypt-tool`
- Node 要求：`>= 14.0.0`（推荐 `v16.13.2`）
- 仓库：[gitee.com/zlhy7/ldDecrypt](https://gitee.com/zlhy7/ldDecrypt)

## 参考项目

- [绿盾解密 node 版本相关讨论](https://github.com/zlhy7/ldDecrypt/issues/7)
- 上游思路：借助本机绿盾环境可读加密文件的能力，流式拷贝为明文文件

## 项目介绍

本工具本身不做密码破解，而是在**已具备绿盾解密权限**的机器上，把「能打开的加密文件」另存为普通文件，便于自动化批处理、接口对接与目录监听。

典型场景：

- 内网办公机装了绿盾，需要批量导出可读副本
- 通过 HTTP 接口给其他系统做解密中转
- 监控投递目录，文件进来即自动解密到输出目录

## 功能特点

1. **Web / REST API** — 浏览器上传解密，或 `curl` 调接口拿结果
2. **目录监控** — 监听源目录，自动解密到目标目录，并提供监控日志页
3. **命令行** — `unlock` 解密单文件或整目录
4. **全局安装（`globalinstall`）** — 注册系统全局命令；Windows 额外开机自启
5. **跨平台脚本** — `globalinstall` / `globalunstall` / `publish:npm` 在 Win / macOS / Linux 均可执行

## 安装服务
### 方式一：本地项目安装
拉取源码后，执行安装命令
```shell
# 1. 安装依赖（开发 / 运行源码）
npm install

# 2. 注册到系统全局命令（可选；无 node_modules 时 globalinstall 会先装依赖）
npm run globalinstall
```

会：

1. 注册全局命令：`ld-decrypt`、`ld-decrypt-tool`、`unlock`
2. **仅 Windows**：配置开机自启 `ld-decrypt-tool`

### 从系统卸载

```shell
npm run globalunstall
```

会：

1. 移除全局命令（服务启动命令与 `unlock` 命令行都不可用）
2. **仅 Windows**：清除开机自启

### 方式二：从 npm 全局安装（外网）

```shell
# 安装
npm install -g @zlhy7/ld-decrypt-tool
# 卸载
npm uninstall -g @zlhy7/ld-decrypt-tool
```
## 本地项目：编译 / 运行（可选）

本项目为纯 Node.js 源码，**无需编译**。安装依赖后直接运行：

```shell
npm start          # 生产方式启动 Web 服务
npm run dev        # nodemon 热重启（开发）
```

全局安装（`npm run globalinstall`）后，也可用：

```shell
ld-decrypt
ld-decrypt-tool
```

## 发布私服 / npm

将当前版本推到 npm（`publishConfig` 指定的源，当前为官方 `registry.npmjs.org`），供外网全局安装：

```shell
# 1. 在 .npmrc 配置真实 _authToken（勿提交明文密钥）
# 2. 如需升版本：npm version patch
npm run publish:npm
```

## 如何使用

### 前提

- 电脑已安装并可正常使用绿盾环境，否则解密结果不可用
- Node.js `>= 14` ,安装教程参考[Node.js 安装教程](https://shafulin.hitcard.cc/znote/views/notes/installation_tutorial/nodejs)

### Web 界面启动

```shell
ld-decrypt
# 或
ld-decrypt-tool
```
![](img/服务模式.png)

浏览器访问：`http://localhost:3000`

监控日志页：`http://localhost:3000/monitor`

### 解密方式一：REST API

```shell
curl -X POST -F "file=@加密文件.txt" http://localhost:3000/api/decrypt --output 解密文件.txt
```

### 解密方式二：目录监控,可自定义监控目录和解密目录

启动服务后，可在 Web 页配置监控目录；也可用环境变量：

```shell
MONITORED_PATH=/path/to/watch 
MONITORED_DECRYPT_PATH=/path/to/decrypt
```

默认（Windows 风格路径）：

- 监控：`D:/fileWatch`
- 输出：`D:/fileWatch_解密`

### 解密方式三：命令行

```shell
# 解密单个文件（未指定输出时，在当前目录生成 uncode_*）
unlock ./encrypted-file.txt
unlock ./encrypted-file.txt ./decrypted-file.txt

# 解密整个目录
unlock ./encrypted-dir/ ./decrypted-dir/
```
![](img/命令行模式.png)

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | Web 服务端口 | `3000` |
| `MONITORED_PATH` | 监控源目录 | `D:/fileWatch` |
| `MONITORED_DECRYPT_PATH` | 解密输出目录 | `D:/fileWatch_解密` |

### 开机自启（仅 Windows）

- `npm run globalinstall`：注册全局命令，并在 Windows 写入启动项 / 任务计划
- `npm run globalunstall`：移除全局命令，并清除 Windows 自启配置
- macOS / Linux：只处理全局命令，不涉及自启
- 手动补配自启（Windows 管理员）：

```shell
node scripts/setup-autostart.js
```

## 注意事项

请确保你有权解密目标文件，并遵守所在地区法律法规及企业数据安全政策。勿将本工具用于未授权数据外传或其他违法用途。

## 纯小白安装教程

### 1.安装nodejs

`官直`[node-v24.19.0](https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi) | [nodejs官网](https://nodejs.org/zh-cn/download)

安装时无脑下一步就行，安装完成后，在cmd中输入`node -v`，如果出现版本号，则说明安装成功。

### 2.安装命令
```shell
npm install -g @zlhy7/ld-decrypt-tool
```

### 3.启动前端服务(可选)
> 前端服务主要用于查看解密日志和配置监控目录，如果不需要，可以跳过这一步。但是就没有监控目录功能了。

> 保持cmd窗口打开，不要关闭，否则服务会停止。

```shell
ld-decrypt-tool
```

### 4.命令行解密
```shell
# 解密单个文件
unlock ./encrypted-file.txt
unlock ./encrypted-file.txt ./decrypted-file.txt

# 解密整个目录
unlock ./encrypted-dir/ ./decrypted-dir/
```