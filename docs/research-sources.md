# 研究来源索引

本项目是原创的 Skill 设计，参考了公开开源研究中的方法和设计思想。项目不再分发任何第三方源代码，也不克隆或重新发布任何第三方仓库。

下表区分两种关系：

- **方法/设计影响**：对当前 Skill 的组织方式、流程边界或证据模型提供了直接参考。
- **研究/比较参考**：用于了解相关工具、工作流或验证方法，不表示其直接参与了当前实现。

## 方法/设计影响

| 仓库 | 研究用途 |
|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 研究可组合 Skill、独立说明文件和共享参考资料的组织方式。 |
| [YoloFame/AutoQA-Agent](https://github.com/YoloFame/AutoQA-Agent) | 研究以文档作为验收媒介、执行证据和结果追溯的思路。 |
| [hadetan/ouroboros-tester](https://github.com/hadetan/ouroboros-tester) | 研究规格、验证和测试生成之间的可追溯关系。 |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | 研究 Human-in-the-loop 审批和人工决策边界。 |
| [aws-samples/sample-qa-studio](https://github.com/aws-samples/sample-qa-studio) | 研究将规则和文档资产纳入回归验证的方式。 |
| [ohanedan/playwright-testgen](https://github.com/ohanedan/playwright-testgen) | 研究计划、生成和修复的阶段化流程，当前实现将其抽象为 QA 阶段顺序。 |
| [SanthoshDhandapani/specwright](https://github.com/SanthoshDhandapani/specwright) | 研究执行前规格和审阅门槛，当前实现采用更窄的文档型 QA 边界。 |

## 研究/比较参考

| 仓库 | 研究用途 |
|---|---|
| [qawolf/cli](https://github.com/qawolf/cli) | 比较 QA CLI、持续集成执行和自动化资产封装方式。 |
| [yusuftayman/playwright-cli-agents](https://github.com/yusuftayman/playwright-cli-agents) | 比较规划、生成和修复 Agent 的协作模式。 |
| [akatz-ai/browserflow](https://github.com/akatz-ai/browserflow) | 比较探索、审阅和迭代式浏览器测试流程。 |
| [MyNameIsEdi/open-qa](https://github.com/MyNameIsEdi/open-qa) | 比较多 Agent QA 工作区和浏览器自动化代理。 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | 了解端到端测试框架、定位器、追踪和截图等基础能力。 |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 比较通过 MCP 向 Agent 提供浏览器操作的方式。 |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | 比较 AI 浏览器操作和将探索结果固化为代码的模式。 |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | 比较浏览器 Agent 探索和 QA 自动化思路。 |
| [lost-pixel/lost-pixel](https://github.com/lost-pixel/lost-pixel) | 比较视觉回归检查和门禁方式。 |
| [argos-ci/argos](https://github.com/argos-ci/argos) | 比较视觉测试产物、截图审阅和报告流程。 |
| [NihadMemmedli/quorvex_ai](https://github.com/NihadMemmedli/quorvex_ai) | 比较从规格或应用探索到 Playwright 测试的流程。 |
| [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) | 比较 Agent 评估命令行工具、机器可读结果和退出码。 |
| [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) | 比较 Agent、Skill 加载和任务编排相关的工程实践。 |

以上链接仅指向公开 GitHub 仓库。研究结论只用于说明方法层面的参考关系，不代表代码、实现或许可证的继承关系。
