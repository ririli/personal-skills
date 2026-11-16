# GoRacer 派生树方法

论文 *GoRacer: Detecting Non-blocking Concurrency Bugs in Go Based on Goroutine Derivation Tree*，§3.3 Definition 2、Algorithm 2、图 3，以及 §3.4、图 4。

论文从 Go 调用图的入口遍历。遇到 `go` 创建调用时，创建子 goroutine 节点，并用调用点标记从父到子的派生边。普通函数调用及其间接调用归入所在 goroutine。图 3 的两个子 goroutine 都调用了相同的函数，仍是两条独立分支。

论文在定位冲突操作所属 goroutine 后，用父子关系或最近公共祖先（LCA）找到两条派生路径与对应的创建位置，再结合控制流及同步操作进行 happens-before 分析。图 4 也展示了当前分析中找不到公共祖先的情况。

## 应用于已有报告

- 报告中的 ID 标识该条报告内的 goroutine 实例。访问栈用于显示执行路径，创建栈用于定位创建位置和创建者侧的函数路径，栈帧保持原始顺序。普通调用、两个 goroutine 中重名的函数以及重复执行的同一处 `go` 语句都不会合并运行时实例。
- 标准 Go `-race` 的 `Goroutine N (...) created at:` 标题给的是子 ID。缺少父实例证据时，根节点表示当前谱系的已知边界。对分离的分支，关系显示为“谱系未知”。共同祖先即从两个访问 goroutine 沿父边回溯时最先共用的节点，两条路径都由已确认边组成才会确认该祖先。
- 经核对的源码可把创建栈关联到实际 `go` 语句，并沿明确的调用上下文提出候选父边。把文件、行号和调用依据记录在边上。函数上下文有时能确定，而运行中的父 ID 仍未知，此时可显示单独的源码上下文节点。只有证据指向同一个具体上下文时才能共用节点。
- 冲突关系是报告提供的访问配对。在网页中以无向关系显示。创建顺序、源码行号、`Previous` 标签及图中位置都不足以判断两次访问的 happens-before。

[Go 数据竞争检测器报告格式](https://go.dev/doc/articles/race_detector#Report_Format)
