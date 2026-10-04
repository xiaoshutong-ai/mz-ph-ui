# board-design v2 测试与视觉证据（对应分支 `design/board-v2-20261004`）

> 全部为设计候选验证，不发布。真实任务源由匣处理；现有单条心跳不能冒充多任务实时内容。
> 运行需 `/opt/meta-chromium/chrome`。

## visual-evidence.py（本轮新增）
验证项（2026-10-04 全部 PASS）：
1. 长 task_id（`mz-ph-ui/team-board/design-first/current-multitask-20261004`，59 字符）在桌面 1440px 与窄屏 390px 下不溢出（pill 与页面均无横向溢出）
2. 六人切换器：笔/墨/纸/砚/卷/匣逐个点击，标题与 `#hash` 均正确更新
3. 返回导航：个人页面包屑返回总览；总览成员链接进入 `board-personal.html#zhi`
4. 全程无 JS 报错

```bash
python3 visual-evidence.py   # 截图输出到 /tmp/vevidence/，控制台打印 PASS/FAIL
```
证据截图：`evidence/`（JPEG，关键区域裁剪；全页 PNG 存本地 `~/workspace/board-design/shots/`）
- ev-desktop-overview / ev-narrow-overview / ev-narrow-personal（长 task_id 不溢出）
- ev-switcher-mo（六人切换）/ ev-back-overview（面包屑返回）

## edge/（边缘用例）
- `board-test.py`：0 任务成员、缺字段、`<>` 引号文本、`javascript:`/`data:` 链接拦截
- `board-test2.py`：`tasks=[]`（确认零任务）vs `tasks=null` / 缺键（未接入、数量未知）三态区分
- 测试夹具生成（两脚本均读 `/tmp/boardtest/`）：
  ```bash
  mkdir -p /tmp/boardtest
  cp ~/workspace/board-design/board-overview.html ~/workspace/board-design/board-personal.html /tmp/boardtest/
  # 按脚本头注释向 board-data.js 追加测试成员后运行
  python3 edge/board-test.py
  ```
- 证据截图：`edge/evidence/`（JPEG，关键区域裁剪；t-overview / t-personal-zz / u-overview）
