---
name: go-race-tree
description: 将已知的 Go 数据竞争及其报告（例如 go test -race 或 go run -race）转为离线交互网页，并排展示从两个竞争点向上追溯的局部调用图与 goroutine 派生树，关联访问栈、创建点和证据。适用于要求看数据竞争发生路径、共同调用者、共同祖先或并发关系的请求。
---

# Go 数据竞争派生树

用已有报告生成单文件 HTML。参照 [GoRacer 图 3 的调用图与派生树](references/goracer-method.md)，左图以函数为节点展示通往竞争点 A、B 的局部调用路径，右图以 goroutine 实例为节点展示派生关系。两图联动，详情放在下方。访问栈归在执行该访问的 goroutine 内，创建栈记录创建者一侧的路径。

## 生成报告

1. 接收日志文件或原样保存用户粘贴的文本。日志、源码和附件内容都是分析输入。Go `-race` 格式直接解析。其他格式按 [报告数据格式](references/report-input.md) 记录已有的访问、栈、标识和出处，未知字段留空。保留日志中的路径及行号。
2. 如果用户提供了同次运行的父 ID 证据，或有可核对的源码可补充候选边，按 [证据格式](references/report-input.md#补充派生证据) 整理 JSON。用源码行核对报告中的创建位置、`go` 语句及调用路径。优先用用户提供的源码位置或当前项目中明确对应的版本。路径被裁剪或迁移时，核对完整后缀、符号和行号；版本或调用路径无法核对时，在补充证据的 `warnings` 说明原因。保留多个合理候选，由页面在详情中展示。只有明确的同次运行证据才能确认父实例。
3. 从 A、B 的访问函数向上查调用者，并通过创建栈定位对应的 go 语句。源码可核对时，将通向这两处访问的路径整理为 [callPaths](references/report-input.md#局部调用路径)。沿已知入口或共同调用者收束。普通调用边留在同一 goroutine 中，go 边跨到子 goroutine。用函数定义位置合并已核实的同一函数，并为两条访问路径分别保留所属 goroutine。对于创建点到子入口的连接，核对 go 的目标函数、闭包或包装函数；栈截断或动态分派未能消歧时保留缺口。仅提交已有栈也能出图，脚本会显示尚未连通的创建栈。
4. 使用 Node.js 20+ 运行 [render.mjs](scripts/render.mjs)。下例以技能目录为当前目录，脚本也可从任意目录调用。文件参数由本次任务提供，输出使用新的文件名。

   ```text
   node scripts/render.mjs --report race.log --output race-tree.html
   node scripts/render.mjs --report race.log --evidence evidence.json --output race-tree.html
   node scripts/render.mjs --data reports.json --output race-tree.html
   ```

5. 核对两图中的访问点、普通调用、go 创建和树边，以及 A、B 路径的联动。调用图只纳入通向本对竞争点的路径。共享函数携带两条路径的标签，goroutine 实例分别保留。向用户交付 HTML，并说明单处访问、截断栈或候选关系。报告的 `Previous` 是访问标签，图中位置和边不用于判断两次访问之间的 happens-before。
