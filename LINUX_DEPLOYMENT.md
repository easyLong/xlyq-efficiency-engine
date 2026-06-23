# Linux 部署文档

更新时间：2026-06-22

本文档用于把 `xlyq-efficiency-engine` 部署到 Linux 服务器，采用：

- NestJS 后端直接托管静态管理端页面
- MySQL 作为业务数据库
- `systemd` 托管 Node 进程
- Nginx 反向代理到后端端口

## 1. 服务器要求

推荐配置：

- Ubuntu 22.04 / 24.04 或 CentOS 8+ / Rocky Linux 9+
- Node.js 20 LTS 或 22 LTS
- MySQL 8.0，或使用已准备好的云数据库
- Git
- Nginx
- 至少 2C4G，磁盘按附件和日志增长预留

如果员工需要从飞书移动端打开交付登记页，服务器必须有公网 HTTPS 域名，并把 `APP_PUBLIC_BASE_URL` 配成该域名。

## 2. 安装基础依赖

Ubuntu / Debian：

```bash
sudo apt update
sudo apt install -y git curl nginx mysql-client

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

CentOS / Rocky Linux：

```bash
sudo dnf install -y git curl nginx mysql

curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

node -v
npm -v
```

## 3. 拉取代码

建议统一部署到 `/opt`：

```bash
sudo mkdir -p /opt
sudo chown -R $USER:$USER /opt

cd /opt
git clone https://github.com/easyLong/xlyq-efficiency-engine.git
cd xlyq-efficiency-engine
```

如果服务器已经有代码：

```bash
cd /opt/xlyq-efficiency-engine
git fetch origin main
git pull --ff-only origin main
```

## 4. 配置数据库

如果使用云数据库，只需要创建数据库和账号，并确保服务器安全组允许访问 MySQL。

示例：

```sql
CREATE DATABASE IF NOT EXISTS ops_platform
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

CREATE USER 'xlyq_app'@'%' IDENTIFIED BY 'replace-with-strong-password';
GRANT ALL PRIVILEGES ON ops_platform.* TO 'xlyq_app'@'%';
FLUSH PRIVILEGES;
```

导入表结构：

```bash
cd /opt/xlyq-efficiency-engine
mysql -h <DB_HOST> -P 3306 -u xlyq_app -p ops_platform < mysql_schema.sql
```

如果是从旧环境迁移数据，优先使用数据库备份恢复；项目内 `backend/scripts/migrate-project-tables.js` 只适合项目表跨库迁移，不替代完整备份。

## 5. 配置环境变量

```bash
cd /opt/xlyq-efficiency-engine/backend
cp .env.example .env
nano .env
```

生产建议配置：

```env
PORT=9000
HOST=127.0.0.1
APP_PUBLIC_BASE_URL=https://your-domain.example.com
TASK_ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret

DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=xlyq_app
DB_PASSWORD="replace-with-strong-password"
DB_NAME=ops_platform

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BOT_WEBHOOK_URL=
FEISHU_EVENT_VERIFICATION_TOKEN=
FEISHU_DEFAULT_DEPARTMENT_ID=0

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

说明：

- `PORT`：Node 后端监听端口，推荐 9000。
- `HOST=127.0.0.1`：只允许本机 Nginx 转发访问，更适合公网部署。
- 如果暂时只在局域网访问，可设为 `HOST=0.0.0.0`，并把 `APP_PUBLIC_BASE_URL` 配成 `http://服务器局域网IP:9000`。
- `APP_PUBLIC_BASE_URL` 会写入飞书按钮和交付登记链接；上线后必须是用户能访问到的地址。
- `TASK_ACCESS_TOKEN_SECRET` 必须换成足够长的随机字符串。
- 数据库变量名是 `DB_USER` 和 `DB_NAME`。

## 6. 安装依赖并构建

```bash
cd /opt/xlyq-efficiency-engine/backend
npm ci
npm run build
```

验证启动：

```bash
npm run start:prod
```

另开一个终端验证：

```bash
curl http://127.0.0.1:9000/api/v1/health
```

确认正常后停止前台进程，继续配置 `systemd`。

## 7. systemd 服务

创建专用运行用户：

```bash
sudo useradd --system --home /opt/xlyq-efficiency-engine --shell /usr/sbin/nologin xlyq
sudo chown -R xlyq:xlyq /opt/xlyq-efficiency-engine
```

创建服务文件：

```bash
sudo nano /etc/systemd/system/xlyq-efficiency-engine.service
```

写入：

```ini
[Unit]
Description=XLYQ Efficiency Engine
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/xlyq-efficiency-engine/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=xlyq
Group=xlyq

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable xlyq-efficiency-engine
sudo systemctl start xlyq-efficiency-engine
sudo systemctl status xlyq-efficiency-engine
```

查看日志：

```bash
sudo journalctl -u xlyq-efficiency-engine -f
```

### 运维脚本

仓库内提供了 systemd 模式的启动、关闭、重启和状态检查脚本：

```bash
cd /opt/xlyq-efficiency-engine

# 启动服务；如果 backend/dist/main.js 不存在，会自动 npm run build
./scripts/linux/start.sh

# 关闭服务
./scripts/linux/stop.sh

# 重启服务并检查健康状态
./scripts/linux/restart.sh

# 查看 systemd 状态并请求健康检查接口
./scripts/linux/status.sh
```

脚本默认把当前目录 `pwd` 当作项目根目录，因此建议先 `cd` 到 `xlyq-efficiency-engine` 仓库根目录再执行。脚本会自动读取 `backend/.env` 中的 `PORT` 和 `HOST` 来生成健康检查地址。`HOST=0.0.0.0` 或 `HOST=::` 会自动转换为 `127.0.0.1` 进行服务器本机健康检查；如果 `HOST` 配的是服务器内网 IP，则会使用该 IP 检查。

脚本默认参数：

```bash
SERVICE_NAME=xlyq-efficiency-engine
APP_DIR=$(pwd)
BACKEND_DIR=$(pwd)/backend
ENV_FILE=$(pwd)/backend/.env
PORT=<读取 backend/.env，缺省为 9000>
HOST=<读取 backend/.env，缺省为 0.0.0.0>
HEALTH_URL=<按 HOST 和 PORT 自动生成>
```

如果服务器部署目录、服务名或端口不同，可以临时覆盖：

```bash
APP_DIR=/data/xlyq-efficiency-engine PORT=9001 ./scripts/linux/start.sh
SERVICE_NAME=xlyq-efficiency-engine-prod ./scripts/linux/restart.sh
HEALTH_HOST=192.168.1.20 ./scripts/linux/status.sh
HEALTH_URL=https://your-domain.example.com/api/v1/health ./scripts/linux/status.sh
```

启动脚本默认不执行 `npm ci`，避免生产环境每次启动都重新安装依赖。发布更新时如需安装依赖或强制重新构建，可执行：

```bash
NPM_INSTALL_ON_START=1 BUILD_ON_START=1 ./scripts/linux/start.sh
```

## 8. Nginx 反向代理

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/xlyq-efficiency-engine
```

写入：

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/xlyq-efficiency-engine /etc/nginx/sites-enabled/xlyq-efficiency-engine
sudo nginx -t
sudo systemctl reload nginx
```

如果是 CentOS / Rocky Linux，常见配置目录是 `/etc/nginx/conf.d/`：

```bash
sudo nano /etc/nginx/conf.d/xlyq-efficiency-engine.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 9. HTTPS

如果使用域名，建议用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

HTTPS 配好后，同步修改：

```env
APP_PUBLIC_BASE_URL=https://your-domain.example.com
```

然后重启服务：

```bash
sudo systemctl restart xlyq-efficiency-engine
```

## 10. 防火墙和安全组

公网部署建议：

- 对公网开放：`80`、`443`
- 不对公网开放：`9000`、`3306`
- MySQL 云数据库只允许应用服务器 IP 访问

Ubuntu UFW 示例：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 11. 飞书配置检查

生产环境要确认：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是正式企业应用。
- 飞书开放平台已发布权限变更。
- `APP_PUBLIC_BASE_URL` 是飞书客户端能访问的公网 HTTPS 地址。
- 如果员工点击“填写项目资产”打不开，优先检查域名、HTTPS、Nginx、服务端口和防火墙。

同步员工：

```bash
curl -X POST https://your-domain.example.com/api/v1/integrations/feishu/contacts/sync-users \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"departmentId":"0","pageSize":50,"recursive":true}'
```

## 12. 发布更新

每次更新代码：

```bash
cd /opt/xlyq-efficiency-engine
sudo -u xlyq git fetch origin main
sudo -u xlyq git pull --ff-only origin main

cd backend
sudo -u xlyq npm ci
sudo -u xlyq npm run build
sudo systemctl restart xlyq-efficiency-engine
sudo systemctl status xlyq-efficiency-engine
```

如果你平时用当前登录用户维护代码，也可以把 `/opt/xlyq-efficiency-engine` 授权给该用户执行 `git pull`，但服务运行用户建议保持为 `xlyq`。

验证：

```bash
curl https://your-domain.example.com/api/v1/health
```

## 13. 回滚

查看最近提交：

```bash
cd /opt/xlyq-efficiency-engine
sudo -u xlyq git log --oneline -10
```

回滚到指定提交：

```bash
sudo -u xlyq git checkout <commit>
cd backend
sudo -u xlyq npm ci
sudo -u xlyq npm run build
sudo systemctl restart xlyq-efficiency-engine
```

恢复到 main 最新版本：

```bash
sudo -u xlyq git checkout main
sudo -u xlyq git pull --ff-only origin main
cd backend
sudo -u xlyq npm ci
sudo -u xlyq npm run build
sudo systemctl restart xlyq-efficiency-engine
```

## 14. 常见问题

### 页面打不开

检查：

```bash
sudo systemctl status xlyq-efficiency-engine
sudo journalctl -u xlyq-efficiency-engine -n 100
curl http://127.0.0.1:9000/api/v1/health
sudo nginx -t
```

### 数据库连接失败

检查：

- `.env` 是否在 `/opt/xlyq-efficiency-engine/backend/.env`
- 变量名是否为 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
- MySQL 安全组是否允许服务器 IP
- 数据库字符集是否为 `utf8mb4`

### 飞书按钮打不开

检查：

- `APP_PUBLIC_BASE_URL` 是否为公网 HTTPS 地址
- Nginx 是否已启用 HTTPS
- `TASK_ACCESS_TOKEN_SECRET` 是否配置且服务已重启
- 手机网络是否能访问该域名

### 上传图片失败或请求过大

当前后端 JSON 和 URL 编码请求限制为 12 MB，Nginx 建议配置：

```nginx
client_max_body_size 20m;
```

如果要支持更大图片，需要同时调整后端请求体限制和 Nginx 限制。
