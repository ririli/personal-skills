# Personal Codex Skills

本仓库收录个人使用的 Codex 技能。每个技能目录都以 `SKILL.md` 为入口，按需附带脚本、模板和参考资料。

## 手动调用

仓库中的所有技能均配置为仅手动调用。每个技能的 `agents/openai.yaml` 都包含以下设置。

```yaml
policy:
  allow_implicit_invocation: false
```

在 Codex 中输入 `$技能名称` 显式调用。例如，输入 `$go-race-tree 根据 race.log 生成数据竞争派生树`。

## 技能列表

| 技能 | 用途 |
| --- | --- |
| [`$developer-report`](developer-report/SKILL.md) | 根据日志和源码撰写或翻译开发者缺陷报告。 |
| [`$eli5`](eli5/SKILL.md) | 用通俗语言解释主题和原理。 |
| [`$go-algorithm-scaffold`](go-algorithm-scaffold/SKILL.md) | 生成 Go 算法练习的函数框架和表驱动测试。 |
| [`$go-race-tree`](go-race-tree/SKILL.md) | 将 Go 数据竞争报告转成离线交互式 goroutine 派生树。 |
| [`$gopie-experiment-report`](gopie-experiment-report/SKILL.md) | 根据已有日志和运行记录整理 GoPie 项目实验报告。 |
| [`$interview-experience-research`](interview-experience-research/SKILL.md) | 搜集公开面经并按主题整理题目和出处。 |
| [`$tech-interview-coach`](tech-interview-coach/SKILL.md) | 讲解技术面试问题并组织口述回答。 |
