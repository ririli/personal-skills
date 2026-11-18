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

## 局部调用路径

`--data` 和 `--evidence` 中每条报告可提供 `callPaths` 数组。补充证据按访问索引替换该访问原有的图示路径。`access: 0` 对应 A，`access: 1` 对应 B。每条路径的 `nodes` 从已知入口或共同调用者排列到竞争访问所在函数，`edges[i]` 连接 `nodes[i]` 到 `nodes[i+1]`。同一访问可提供多条有依据的候选路径，每条均须终止于该访问。

```json
{
  "reports": [{
    "id": 1,
    "callPaths": [{
      "access": 0,
      "nodes": [
        { "symbol": "main.launch()", "goroutine": "main",
          "definition": { "file": "main.go", "line": 10 } },
        { "symbol": "main.worker()", "goroutine": "6", "file": "worker.go", "line": 8,
          "definition": { "file": "worker.go", "line": 5 } }
      ],
      "edges": [{
        "kind": "go", "status": "inferred", "source": "source",
        "site": { "file": "main.go", "line": 13 },
        "evidence": "对应版本的 main.go:13 为 go worker()，创建栈和访问栈分别对应 launch 和 worker。"
      }]
    }]
  }]
}
```

示例假定报告 1 的 A 由 G 6 执行，且该报告已声明 main 与 6。

- 节点需要 `symbol`。`definition` 是已核对的函数声明位置，同一文件、声明行及符号表示同一函数，可跨 goroutine 合并。匿名函数和同名函数用各自声明位置区分，重复定义表示递归。缺少声明位置时，仅在该路径内用符号与文件区分，跨路径保持独立。
- `goroutine` 可省略以表示所属实例未知，填写时须使用本报告已声明的 ID。末节点必须填写竞争访问的 goroutine ID。普通调用两端若都填写 ID，应相同；go 创建两端应不同。函数身份与 goroutine 实例分别记录，函数合并不影响派生树。
- 节点还可提供 `file`、`line`、`offset`、`rawLine`，表示该路径上报告记录的位置。函数声明位置与实际访问位置分别记录。末节点对应本次访问函数，访问行号以原报告为准。
- 每条边需要 `kind`（`call` 或 `go`）、`status`（`confirmed` 或 `inferred`）、`source`（`report` 或 `source`）及可核对的 `evidence`。源码边必须有调用位置 `site`，报告边可提供它。这里的 confirmed 表示函数调用关系有明确证据，运行时父 ID 的确认仍由派生树父级证据决定。
- 缺少 callPaths 的访问由已有栈生成局部图，访问栈按外层到内层绘制，创建栈单独绘制并显示未核对入口的缺口。源码推断、截断栈或无法核对的路径补充到报告 `warnings`。

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
