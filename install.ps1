# ld-decrypt-tool 一键安装脚本
# 天锐绿盾文件解密工具
# 使用方式: irm https://pi.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"
$PACKAGE_NAME = "ld-decrypt-tool"
$NODE_VERSION = "v24.9.0"
$NODE_MIRROR = "https://mirrors.huaweicloud.com/nodejs"
$NODE_INSTALL_DIR = "$env:LOCALAPPDATA\node"

# 检测是否通过管道执行（irm | iex 方式）
$isPipedExecution = $MyInvocation.MyCommand.Path -eq $null

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  天锐绿盾文件解密工具 - 一键安装脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检测Node.js是否已安装
function Test-NodeInstalled {
    try {
        $nodePath = Get-Command node -ErrorAction Stop
        $version = & node --version 2>$null
        return @{ Installed = $true; Version = $version; Path = $nodePath.Source }
    } catch {
        return @{ Installed = $false; Version = $null; Path = $null }
    }
}

# 检测npm是否已安装
function Test-NpmInstalled {
    try {
        $npmPath = Get-Command npm -ErrorAction Stop
        $version = & npm --version 2>$null
        return @{ Installed = $true; Version = $version; Path = $npmPath.Source }
    } catch {
        return @{ Installed = $false; Version = $null; Path = $null }
    }
}

# 下载文件（带进度显示）
function Download-File {
    param(
        [string]$Url,
        [string]$Output
    )
    
    Write-Host "正在下载: $Url" -ForegroundColor Yellow
    
    # 使用.NET WebClient下载
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($Url, $Output)
    
    Write-Host "下载完成: $Output" -ForegroundColor Green
}

# 安装Node.js
function Install-Node {
    Write-Host ""
    Write-Host "检测到未安装Node.js，开始安装..." -ForegroundColor Yellow
    
    # 创建临时目录
    $tempDir = "$env:TEMP\ld-decrypt-install"
    if (!(Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    }
    
    # 下载Node.js
    $nodeFileName = "node.exe"
    $downloadUrl = "$NODE_MIRROR/$NODE_VERSION/win-x64/$nodeFileName"
    $downloadPath = "$tempDir\$nodeFileName"
    
    # 创建安装目录
    if (!(Test-Path $NODE_INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $NODE_INSTALL_DIR -Force | Out-Null
    }
    
    # 下载node.exe
    Download-File -Url $downloadUrl -Output $downloadPath
    
    # 复制到安装目录
    Copy-Item -Path $downloadPath -Destination "$NODE_INSTALL_DIR\$nodeFileName" -Force
    
    # 添加到PATH（当前用户）
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$NODE_INSTALL_DIR*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$NODE_INSTALL_DIR", "User")
        $env:Path = "$env:Path;$NODE_INSTALL_DIR"
        Write-Host "已将 $NODE_INSTALL_DIR 添加到用户PATH" -ForegroundColor Green
    }
    
    # 清理临时文件
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host "Node.js $NODE_VERSION 安装完成！" -ForegroundColor Green
    
    # 验证安装
    $nodeCheck = Test-NodeInstalled
    if ($nodeCheck.Installed) {
        Write-Host "Node.js版本: $($nodeCheck.Version)" -ForegroundColor Green
        Write-Host "Node.js路径: $($nodeCheck.Path)" -ForegroundColor Green
        return $true
    } else {
        Write-Host "警告: Node.js安装可能需要重启终端才能生效" -ForegroundColor Yellow
        Write-Host "请关闭当前窗口，重新打开PowerShell后再次运行此脚本" -ForegroundColor Yellow
        return $false
    }
}

# 主流程
Write-Host "[步骤 1/3] 检测Node.js环境..." -ForegroundColor Cyan
$nodeResult = Test-NodeInstalled

if ($nodeResult.Installed) {
    Write-Host "已安装Node.js: $($nodeResult.Version)" -ForegroundColor Green
    Write-Host "路径: $($nodeResult.Path)" -ForegroundColor Gray
} else {
    $installResult = Install-Node
    if (!$installResult) {
        Write-Host ""
        Write-Host "安装未完成，请重启终端后重新运行此脚本" -ForegroundColor Red
        if (!$isPipedExecution) { Read-Host "按Enter键退出" }
        exit 1
    }
}

Write-Host ""
Write-Host "[步骤 2/3] 检测npm环境..." -ForegroundColor Cyan
$npmResult = Test-NpmInstalled

if ($npmResult.Installed) {
    Write-Host "已安装npm: v$($npmResult.Version)" -ForegroundColor Green
} else {
    Write-Host "错误: npm未安装，请先安装Node.js" -ForegroundColor Red
    if (!$isPipedExecution) { Read-Host "按Enter键退出" }
    exit 1
}

Write-Host ""
Write-Host "[步骤 3/3] 安装 $PACKAGE_NAME ..." -ForegroundColor Cyan

# 全局安装npm包
Write-Host "正在执行: npm install -g $PACKAGE_NAME" -ForegroundColor Yellow
try {
    & npm install -g $PACKAGE_NAME
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  安装成功！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "使用方法:" -ForegroundColor Cyan
    Write-Host "  1. Web界面模式:" -ForegroundColor White
    Write-Host "     ld-decrypt" -ForegroundColor Yellow
    Write-Host "     然后访问 http://localhost:3000" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. 命令行模式:" -ForegroundColor White
    Write-Host "     unlock <源路径> [目标路径]" -ForegroundColor Yellow
    Write-Host "     示例: unlock ./encrypted-file.txt" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  3. npm全局命令:" -ForegroundColor White
    Write-Host "     ld-decrypt-tool" -ForegroundColor Yellow
    Write-Host ""
} catch {
    Write-Host "安装失败: $_" -ForegroundColor Red
    if (!$isPipedExecution) { Read-Host "按Enter键退出" }
    exit 1
}

if (!$isPipedExecution) {
    Write-Host "按Enter键退出..." -ForegroundColor Gray
    Read-Host
}
