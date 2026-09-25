# Proofline 词库来源与范围

## 当前内置词库

当前安装包内置约 3,846 条去重后的词条：100 条 A1-C1 自编核心词、190 条自编扩充词，以及 3,791 个公开词头中未与旧词重复的部分。公开目录原始记录为 NGSL 2,809、NAWL 959、NGSL-S 721 个词头，跨来源按小写词头去重；Open English Wordnet 2025 提供英释、词性和发音；ECDICT 审计映射为 3,791 个目标词补充中文义项，音标覆盖约 99%，但其音标格式并不统一为 IPA。

公开词条保留真实英释、中文义项、词性、发音、频率排名和来源标识。没有公开例句的词条不会填入伪造例句、搭配或助记，刷词卡以主动回忆中文义项和英英释义为主。已有自编词条按英文拼写优先保留，以免破坏旧学习进度。

“四级、六级、托福、雅思、考研、SAT”在产品中是学习方向标签，用于筛选与排程。NGSL/NAWL/NGSL-S 是通用或学术/口语频率表，ECDICT 标签来自第三方聚合数据；这些标签不表示任何考试机构背书，也不等同于官方大纲的完整词表。一个词可以同时属于多个方向。

## 许可边界

词库生成脚本会保留原始文件、版本、SHA-256、署名和许可证信息：

- [New General Service List](https://www.newgeneralservicelist.com/new-general-service-list)：NGSL、NAWL、NGSL-S 页面标明 CC BY-SA 4.0，可用于可商用项目，但衍生数据库也要保留署名、许可证和修改说明。
- [English Wordnet](https://github.com/globalwordnet/english-wordnet)：CC BY 4.0，可补充英释、词形和同义关系。
- [ECDICT](https://github.com/skywind3000/ECDICT)：仓库声明 MIT；本次只抽取与三份公开词表相交的 3,791 个目标词。ECDICT README 同时说明历史数据混入 EDictAZ、cdict 和抓取资料，逐项上游许可没有在仓库中列明，因此安装包将其标为“上游来源链需核验”，不把它称作官方考试词表。

生成入口为 `scripts/generate-public-vocabulary.mjs`，运行时目录入口为 `src/data/vocabularyCatalog.ts`。取得明确授权后，才适合把某个机构的完整考试词表作为独立数据包分发。
