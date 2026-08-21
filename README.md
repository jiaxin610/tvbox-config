# IPTV-API / TVBox 配置

从公开播放列表抓取直播源 → 探测可用性 → 提供 M3U / JSON / TVBox 接口。

## 启动

```bash
npm start
```

默认端口 `8787`（可用环境变量 `PORT` 修改）。

## TVBox 配置地址

```text
http://电脑IP:8787/tvbox/config.json
```

## API

| 路径 | 说明 |
|------|------|
| `GET /` | 接口索引 |
| `GET /api/status` | 最近一次抓取统计 |
| `GET /api/upstreams` | 上游公开列表配置 |
| `GET /api/channels?q=&group=` | 频道 JSON |
| `GET /api/m3u` | 直播 M3U |
| `GET /api/txt` | 直播 TXT |
| `GET /api/refresh` | 立即重新抓取并探测 |
| `GET /tvbox/config.json` | TVBox 配置 |
| `GET /lives.m3u` | 直播列表 |

## 配置上游

编辑 `sources/upstreams.json`：

- `playlists`：公开 M3U 地址（可增删）
- `seed`：始终优先保留的频道
- `maxCandidates`：探测上限
- `refreshHours`：自动刷新间隔

只收录公开列表；会过滤纯 IP 主机等常见未授权镜像特征。请只使用你有权访问的流。
