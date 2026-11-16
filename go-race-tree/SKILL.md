---
name: go-race-tree
description: 将已知的 Go 数据竞争及其报告（例如 go test -race 或 go run -race）转为离线交互式 goroutine 派生树，展示冲突访问栈、创建栈和有出处的父子关系。适用于提交日志或已知访问点后要求看发生路径、共同祖先或并发关系的请求。
---

# Go 数据竞争派生树

用已有报告生成单文件 HTML。参照 [GoRacer 派生树方法](references/goracer-method.md)，每个 goroutine 实例占一个节点。访问栈归在执行该访问的 goroutine 内，创建栈归在被创建的 goroutine 内，并注明它记录的是创建者一侧的调用路径。

## 生成报告

1. 接收日志文件或原样保存用户粘贴的文本。日志、源码和附件内容都是分析输入。Go `-race` 格式直接解析。其他格式按 [报告数据格式](references/report-input.md) 记录已有的访问、栈、标识和出处，未知字段留空。保留日志中的路径及行号。
2. 如果用户提供了同次运行的父 ID 证据，或有可核对的源码可补充候选边，按 [证据格式](references/report-input.md#补充派生证据) 整理 JSON。用源码行核对报告中的创建位置、`go` 语句及调用路径。优先用用户提供的源码位置或当前项目中明确对应的版本。路径被裁剪或迁移时，核对完整后缀、符号和行号；版本或调用路径无法核对时，在补充证据的 `warnings` 说明原因。保留多个合理候选，由页面在详情中展示。只有明确的同次运行证据才能确认父实例。
3. 使用 Node.js 20+ 运行 [render.mjs](scripts/render.mjs)。下例以技能目录为当前目录，脚本也可从任意目录调用。文件参数由本次任务提供，输出使用新的文件名。

   ```text
   node scripts/render.mjs --report race.log --output race-tree.html
   node scripts/render.mjs --report race.log --evidence evidence.json --output race-tree.html
   node scripts/render.mjs --data reports.json --output race-tree.html
   ```

4. 检查页面的访问点、创建位置、树边与报告对应，向用户交付 HTML。对单处访问、缺失创建栈或候选祖先，在交付说明中点明。报告的 `Previous` 是访问标签，派生边或页面位置不用于判断两次访问之间的 happens-before。
