---
type: bug
record_id: bug-1a88afaf58fe4f13859d209b49b49027
date: 2026-08-18
title: 飞书回调服务 Dokploy 部署失败——compose 硬绑宿主端口 8787 冲突
source: 真实部署（Dokploy 首次部署日志）
severity: high
status: resolved
key_conclusion: docker-compose.yml 用 ports 8787:8787 硬绑宿主端口，在共享 Dokploy 主机上 8787 已被占用导致 "port is already allocated" 启动失败；改为仅 expose 8787、由 Dokploy Domain 反代路由到容器端口，部署不再抢宿主端口。
topics: [qa-guardian, deployment, docker]
related: [change-c4f7796c3fa940589c4c90921c26455c]
---

## Bug Description

Dokploy 部署飞书回调服务:镜像构建成功,但容器启动失败:
`Error response from daemon: driver failed programming external connectivity ... Bind for 0.0.0.0:8787 failed: port is already allocated`。

## Root Cause

`tools/guardian/docker-compose.yml` 使用 `ports: - "8787:8787"` 把容器端口硬绑到宿主机 0.0.0.0:8787。Dokploy 是共享主机、多服务共存,宿主 8787 已被占用;且 Dokploy 本身用反向代理 + Domain 路由到容器,不需要也不应该硬绑宿主端口。

## Solution

compose 去掉 `ports` 硬绑,改为 `expose: - "8787"`(仅声明容器端口,不占宿主端口);对外访问改由 Dokploy Domain(Container Port 填 8787)经反代路由。DEPLOY.md 同步:Dokploy 步骤加"加 Domain 指向容器 8787、不要用宿主IP:8787"说明,本地自测改用 `run --rm -p 18787:8787` 临时映射。

## Prevention Measures

容器服务上 PaaS(Dokploy/Fly/Railway 等反代型平台)时,compose 用 `expose` 而非 `ports` 硬绑宿主端口;对外暴露交给平台的 Domain/反代。文档明确"不要绑宿主端口"。

## Related Changes

回调服务本体见 change-c4f7796c...(第二批)与其安全实现;本次仅修 compose 部署配置 + DEPLOY 文档。测试 129/129 不受影响(纯部署配置)。
