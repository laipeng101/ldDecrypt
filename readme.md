# 天锐绿盾文件解密工具

这是一个基于 Node.js 的文件解密工具，它能够利用安装在电脑上的绿盾软件的权限，读取加密文件并保存为解密后的新文件。与原始版本相比，此工具提供了更多的交互方式和更友好的用户界面。

- node版本：node v16.13.2

## 参考项目

[绿盾解密node版本](https://github.com/zlhy7/ldDecrypt/issues/7)

## 功能特性

1. **REST API 接口方式** - 通过 HTTP 接口上传文件并获取解密结果
2. **本地目录监控方式** - 自动监控指定目录，当有新文件加入时自动解密到目标目录，并提供 Web 日志界面
3. **命令行方式** - 提供命令行工具，可以直接解密文件或目录

## 快速安装

### 方式一：npm全局安装（推荐）

```shell
npm install -g ld-decrypt-tool
```

**安装后自动启动服务，并配置开机自启。**

### 方式二：PowerShell一键安装

**一键安装命令（复制到PowerShell执行）：**

```powershell
irm https://gitee.com/zlhy7/ldDecrypt/raw/node-v1.1/install.ps1 | iex
```

**或者下载脚本后运行：**

```powershell
# 下载安装脚本
irm https://gitee.com/zlhy7/ldDecrypt/raw/node-v1.1/install.ps1 -OutFile install.ps1

# 执行安装
.\install.ps1
```

> 脚本会自动检测并安装Node.js环境，无需手动配置。

### 方式三：手动安装

```shell
# 克隆项目
git clone https://gitee.com/zlhy7/ldDecrypt.git
cd ldDecrypt

# 安装依赖
npm install

# 全局链接
npm link
```

## 开机自启说明

- **npm全局安装**：安装后自动配置开机自启，服务随系统启动
- **手动配置**：如需手动配置开机自启，以管理员身份运行：
  ```shell
  node scripts/setup-autostart.js
  ```
- **卸载**：卸载时会自动清理启动项
  ```shell
  npm uninstall -g ld-decrypt-tool
  ```

## 使用方法

### Web界面模式

```shell
# 启动服务
ld-decrypt
# 或
ld-decrypt-tool

# 然后访问 http://localhost:3000
```

### 命令行模式

```shell
# 解密单个文件
unlock ./encrypted-file.txt

# 解密整个目录
unlock ./encrypted-dir/ ./decrypted-dir/
```

### 开发模式

```shell
# 启动开发服务器（自动重启）
npm run dev

# 启动生产服务器
npm start
```

## 服务使用前提

- 电脑必须装有绿盾环境，否则无法解密成功
- Node.js >= 14.0.0（安装脚本会自动检测和安装）

## 使用方法

### 方式一：REST API 接口方式

启动服务器：
```bash
npm start
```

访问 `http://localhost:3000`，使用网页界面上传文件进行解密。

或者使用 curl 等工具直接调用 API：
```bash
curl -X POST -F "file=@加密文件.txt" http://localhost:3000/api/decrypt --output 解密文件.txt
```

### 方式二：本地目录监控方式

启动服务器后访问 `http://localhost:3000` 可以动态配置监控目录，访问 `http://localhost:3000/monitor` 查看实时监控日志。

默认情况下，工具会监控 `D:/fileWatch` 目录，并将解密后的文件放在 `D:/fileWatch_解密` 目录中。

可以通过设置环境变量来自定义监控目录：
```bash
MONITORED_PATH=/path/to/watch MONITORED_DECRYPT_PATH=/path/to/decrypt npm start
```

也可以在网页界面动态配置监控目录，无需重启服务。

### 方式三：命令行方式

```
# 解密单个文件
unlock encrypted-file.txt decrypted-file.txt

# 解密整个目录
unlock encrypted-directory/ decrypted-directory/

# 如果不指定输出路径，将在当前目录创建 uncode_* 目录
unlock encrypted-file.txt
```

## 配置

可以通过设置以下环境变量来配置程序行为：

- `PORT`: 服务器监听端口（默认3000）
- `MONITORED_PATH`: 被监控的目录路径（默认 D:/fileWatch）
- `MONITORED_DECRYPT_PATH`: 解密文件输出目录（默认 D:/fileWatch_解密）

## 注意事项

请确保你有权解密文件，并且了解你所在地区关于解密加密文件的法律限制。使用本工具进行解密操作应遵守相关法律法规和企业政策，确保不会违反数据安全规定。
