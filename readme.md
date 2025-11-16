# 天锐绿盾文件解密工具

这是一个基于 Node.js 的文件解密工具，它能够利用安装在电脑上的绿盾软件的权限，读取加密文件并保存为解密后的新文件。与原始版本相比，此工具提供了更多的交互方式和更友好的用户界面。

- node版本：node v16.13.2

## 参考项目

[绿盾解密node版本](https://github.com/zlhy7/ldDecrypt/issues/7)

## 功能特性

1. **REST API 接口方式** - 通过 HTTP 接口上传文件并获取解密结果
2. **本地目录监控方式** - 自动监控指定目录，当有新文件加入时自动解密到目标目录，并提供 Web 日志界面
3. **命令行方式** - 提供命令行工具，可以直接解密文件或目录

## 安装

确保你的系统已经安装了 Node.js 和 npm。
### 1.下载安装包
下载并安装Node.js，全部默认配置就行

`直`[node-v16.16.0-x64.msi](https://repo.huaweicloud.com/nodejs/v16.16.0/node-v16.16.0-x64.msi)

### 2.配置国内源

> 配置国内源方便安装模块

```shell
# 设置阿里源镜像
npm config set registry https://registry.npmmirror.com

```

> [nodejs安装教程](https://shafulin.sxszck.com/znote/views/notes/installation_tutorial/nodejs.html#_1-%E4%B8%8B%E8%BD%BDnvm)

### 3.安装
```bash
# 克隆或下载项目后，进入项目目录
cd ldDecrypt

# 安装依赖
npm install

# 安装打包工具
npm install -g pkg

# 全局安装（可选）
npm link
```

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
