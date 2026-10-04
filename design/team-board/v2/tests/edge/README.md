# board-design 边缘用例测试（对应 commit 213465a）

## 覆盖
- 0 任务成员（`empty`）：总览显式空态卡、presence"未接入"；个人页五栏全 0 项
- 缺字段任务（`test-001` 缺 stage/repo/evidence/result/next/deps/blocker/priority/checked/updated）：全部降级"未接入"
- 含 `<>` 引号文本：转义为文本，`<script>` 不执行
- 危险链接：`javascript:alert('xss')`、`data:text/html,...` → 0 个可点击 href，显示"已拦截非 http(s) 协议"
- 原 17 条样例：6 成员 / 17 任务不变，无回归

## 复用
```bash
cd ~/workspace/board-design/tests/edge
python3 board-test.py   # 需 /opt/meta-chromium/chrome；输出 t-overview.png / t-personal-zz.png
```
测试数据为 `board-data.js`（原 17 条 + `zz`/`empty` 两测试成员），仅本地测试用，未入仓。

## 2026-10-04 验证结果
cards: 8（6+2 测试）· empty-card presence"未接入" · js-href-links: 0 · intercept-msg: True ·
lt-escaped: True · script-executed: False · missing-field-na: 12 · empty-sections: 0,0,0,0,0 ·
JS errors: none（overview / zz / empty 三处均为 none）
