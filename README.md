# TVBox IPTV 扫描配置

已改为 **IPTV 订阅扫描**（不再内置之前那些公开免费演示源）。

## 使用

1. 编辑 `sources/subscribe.txt`，每行一个你有权使用的订阅地址（m3u / txt）
2. 运行：

```bash
npm run once
```

3. 推送到 GitHub 后，Actions 会按同样逻辑扫描并更新 Pages

## 配置地址

```text
https://jiaxin610.github.io/tvbox-config/config.json
```

扫描逻辑：拉取订阅 → 解析 M3U/TXT → 多线路合并 → 探测可用 → 按延迟保留。
