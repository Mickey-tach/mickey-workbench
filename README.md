# Mickey 工作台

纯前端个人工作台 PWA（待办 / 计划 / 周复盘 / 学习复盘 / 运动 / 记账 / 每日英语 / 今日心情 / 选题灵感 / 裁缝日记 + 实时热点）。

- 纯静态站点，无后端、无构建步骤，直接用浏览器打开 `index.html` 即可运行。
- 数据保存在**浏览器本地**（localStorage + IndexedDB），不上传服务器。
- 首页「💾 数据备份」可把全部数据 + 图片导出为 JSON 文件，换设备 / 清缓存前请先导出，「导入备份」可完整恢复。

## 部署到 GitHub Pages（永久免费链接）

1. 在 GitHub 新建仓库（普通仓库如 `mickey-workbench`，或个人站点仓库 `<用户名>.github.io`）。
2. 推送本目录内容：
   ```bash
   git remote add origin <你的仓库地址>
   git push -u origin main        # 若默认分支是 master，把 main 替换为 master
   ```
3. 仓库 **Settings → Pages → Source** 选 “Deploy from a branch”，分支选 `main`、目录 `/ (root)`，保存。
4. 约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`（个人站点仓库则为 `https://<用户名>.github.io/`）。

> `.nojekyll` 已包含，确保 GitHub 原样托管（不跑 Jekyll）。资源均用相对路径，项目站子路径也能正常工作。

## 注意：换链接 = 换数据源

数据按“网址来源(origin)”隔离。从旧链接搬到新链接时，旧链接里的数据不会自动出现：
请先在**旧链接**首页点「导出备份」，再到**新链接**首页点「导入备份」。
