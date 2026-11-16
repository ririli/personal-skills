# 报告与证据输入

`--report` 接受 Go `-race` 文本，输出中的“日志行”按输入文件从 1 开始计数。重复 goroutine ID 在各条报告中独立处理。命令从当前目录解析输入和输出参数，模板和脚本从技能目录加载。输出路径需指向尚不存在的文件。

## 补充派生证据

`--evidence` 接受下列 JSON。报告 `id` 是网页切换器显示的编号，原始日志按出现顺序从 1 开始。报告中已有的 goroutine 直接用其数字字符串 ID 或 `main` 引用。用 `goroutines` 声明证据中新增的端点；这个字段可省略。每条边给出父 ID、子 ID、证据状态和可定位的依据。

```json
{
  "reports": [
    {
      "id": 1,
      "goroutines": [
        { "id": "12", "label": "调度 goroutine" },
        { "id": "source:launch-worker", "label": "launch 的调用上下文", "context": true }
      ],
      "edges": [
        {
          "parent": "12",
          "child": "18",
          "status": "confirmed",
          "evidence": "同次运行的创建记录第 31 行，父 ID 12，子 ID 18",
          "site": { "file": "worker.go", "line": 44 }
        },
        {
          "parent": "source:launch-worker",
          "child": "12",
          "status": "inferred",
          "evidence": "创建栈首帧对应 launch 中的 go dispatch()，上层调用与 app.go:26 匹配",
          "site": { "file": "app.go", "line": 34 }
        }
      ]
    }
  ]
}
```

示例假定报告 1 已有 ID `18`。可选的 `site` 记录创建位置，`inferred` 边必须提供它。对于源码候选，把创建栈与对应版本的源码核对，确认 `go` 语句及可核对的调用链，再决定边的端点。仅凭同名函数、同一包路径、相同栈帧或同一创建点，无法确认父实例或共用祖先。用 `context: true` 声明无运行时 ID 的源码候选节点，每条独立上下文使用不同 ID。遇到动态分派、多个调用者或不同的可能父实例时，分别记录依据。相互冲突的父级声明或形成循环的边留在证据详情中。

`confirmed` 需要同次运行、且能与报告端点 ID 对应的明确证据。创建栈只说明某个 goroutine 的创建位置。Go 报告使用的标识和另一份运行记录的标识需要有已核实的对应关系。在同报告的补充证据中可加 `warnings` 文本数组，说明源码版本、缺失栈或无法核对的路径。没有边时也可仅提供 `id` 与 `warnings`。

## 其他报告格式

用 `--data` 读取与 Go 报告共用的数据模型。一条报告最多两处访问。全文件至少提供一处访问。ID 为报告内的字符串，可用报告自己的标识。若只知道两次访问来自不同执行上下文，各自使用独立 ID 并以 `label` 标注身份未知。

```json
{
  "reports": [
    {
      "id": 1,
      "goroutines": [
        { "id": "worker", "label": "工作 goroutine" }
      ],
      "accesses": [
        {
          "goroutine": "worker",
          "kind": "write",
          "stack": {
            "frames": [{ "symbol": "update", "file": "worker.go", "line": 9 }],
            "notes": ["调用栈只保留了最内层"]
          }
        }
      ],
      "warnings": ["报告未提供另一次访问和创建栈。"],
      "raw": "检测器原文"
    }
  ]
}
```

- 报告可提供 `raw`、`rawStartLine`（默认 1）和 `warnings`。
- goroutine 可提供 `label`、`state`、`creation`。其中 `creation` 与访问的 `stack` 格式相同。
- 访问的 `kind` 为 `read` 或 `write`，可另提供 `previous`、`atomic`、`address`、`rawLine`。栈可选 `notes` 和 `rawLine`。没有栈时用 `"frames": []`。栈从访问点或创建点向外排列，每个栈帧至少有 `symbol` 或 `file` 与 `line`，可再加 `offset` 和 `rawLine`。
