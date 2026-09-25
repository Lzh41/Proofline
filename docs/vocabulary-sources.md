# Proofline 词库来源与方向范围

## 运行时词库

当前安装包内置 **11,158 个去重词头**，由三层组成：

- 100 条 Proofline 自编核心词和自编扩充词。扩充词按明确的学习方向标签维护，不声称对应官方考试大纲。
- 公开语料词表（NGSL、NAWL、NGSL-S）与 Open English Wordnet，用于通用和学术英语。它们提供频率、英释和词性，不是考试机构发布的固定词单。
- ECDICT 明确考试标签词集。构建脚本只收录标签明确、含中文义项、英文释义和 IPA-Dict 音标的英文词头；缺任一项就排除，不猜读音。

本次 ECDICT 词集共 10,515 个唯一词头。合并语料方向标签与自编词后，各独立方向共有：

| 方向 | 词条数 | 方向来源 |
| --- | ---: | --- |
| 四级 | 3,835 | ECDICT `cet4` 标签 + 有同一词头的自编条目 |
| 六级 | 5,386 | ECDICT `cet6` 标签 + 有同一词头的自编条目 |
| 托福 | 7,240 | ECDICT `toefl` 标签 + NAWL 学术词表 + 自编条目 |
| 雅思 | 5,499 | ECDICT `ielts` 标签 + NAWL 学术词表 + 自编条目 |
| 考研 | 5,223 | ECDICT `ky` 标签、NAWL 学术词表 + 自编条目 |
| SAT | 3,780 | NGSL 高频词 + NAWL 学术词表 + 自编 SAT 学术阅读候选词 |

方向之间允许同一词重复，但进度、每日计划、复习记录按方向作用域独立保存。考试筛选只看显式考试标签或明确的 SAT 语料筛选标签，不再把 CEFR 难度自动当作考试归属。ECDICT 新词的 A2-C1 层级由其 `frq` 频率排名近似映射，仅供难度筛选，不等于官方 CEFR 评级。

## 音标

所有进入运行时的词条都必须有 `/.../` 形式的 IPA。音标优先取 `ipa-dict` 英美音数据中的美音，缺失时用英音补齐；多发音以逗号分隔保留。生成脚本会拒绝音标为空、格式异常或去掉斜线后直接等于词面的记录。

核心自编词的音标仍保留项目人工校准值；构建测试会检查全量词库无空音标、无直接泄露单词的音标，并检查公开词条与 IPA-Dict 快照一致。

## 许可与边界

- [New General Service List](https://www.newgeneralservicelist.com/new-general-service-list)、[New Academic Word List](https://www.newgeneralservicelist.com/new-academic-word-list)、NGSL-S：作者站说明 Creative Commons 且允许商业使用；发布时保留署名、许可和修改说明。
- [Open English Wordnet](https://github.com/globalwordnet/english-wordnet)：CC BY 4.0，并遵守其上游 Princeton WordNet 条款。
- [ipa-dict](https://github.com/open-dict-data/ipa-dict)：项目 MIT；英语数据的上游许可与署名一并保留。
- [ECDICT](https://github.com/skywind3000/ECDICT)：仓库声明 MIT，但 README 说明其历史上汇集多个字典和抓取资料；`vocabularyExamRecords.ts` 记录了输入 SHA、音标快照 SHA 和 `review-required` 状态。正式商业发布前仍需逐项核验上游内容或购买明确的离线再分发授权。

ETS、IELTS、College Board 没有公开找到可下载、允许离线再分发的完整官方 TOEFL、IELTS、SAT 词单。因此产品文案使用“学习词集/学术语境范围”，不称其为官方考纲。若需要官方或商业专属词库，应向词表出版方购买并在合同中明确离线打包、衍生数据和更新权。

## 各方向调研结论（2026-09-25）

当前每个方向都按独立标签和独立进度维护；同一词可在多个方向出现，但不会共用复习间隔。

| 方向 | 当前内置数量 | 采用的可追溯范围 | 官方词单结论 |
| --- | ---: | --- | --- |
| 四级 | 3,835 | ECDICT `cet4` 显式标签 + NGSL 高频词 | CET 官方提供考试大纲，但未提供可直接随商业软件再分发的完整开放词单 |
| 六级 | 5,386 | ECDICT `cet6` 显式标签 + NGSL/NAWL | 同上；大纲下载不等于词表再分发授权 |
| 托福 | 7,240 | ECDICT `toefl` 显式标签 + NAWL/NGSL-S + Open English Wordnet | ETS 备考材料受版权保护，未找到可离线再分发的完整官方词单 |
| 雅思 | 5,499 | ECDICT `ielts` 显式标签 + NAWL/NGSL-S 学术语料 | IELTS/Cambridge 提供备考材料，未找到可离线再分发的完整官方词单 |
| 考研 | 5,223 | ECDICT `ky` 显式标签 + NAWL/NGSL/公开频率语料 | 常见“5500 词”由出版商整理，未找到可自由再分发的官方完整词单 |
| SAT | 3,780 | NGSL + NAWL + 学术阅读候选词 | College Board 提供练习材料，未找到可离线再分发的完整官方词单 |

官方入口用于范围核对：CET [考试大纲](https://cet.neea.edu.cn/html1/folder/16113/1588-1.htm)、ETS [TOEFL 备考](https://www.ets.org/toefl/test-takers/ibt/prepare.html)、IELTS [备考资源](https://ielts.org/take-a-test/preparation-resources)、College Board [SAT 练习](https://satsuite.collegeboard.org/practice)、中国研招网 [考试信息](https://yz.chsi.com.cn/)。这些页面不能替代离线词库授权。

若要采购商业数据，优先评估 Oxford Dictionaries API 和 Merriam-Webster API。合同必须明确离线缓存和安装包再分发、用户/设备数、衍生数据库、音标与音频授权、更新期限、地域限制和下架机制；只有在线查询权通常不等于可把整库打入安装包。采购完成前继续使用本文件列出的公开来源，并在发布包中保留各来源许可证和 NOTICE。

## 重新生成

使用经过审计的输入文件运行：

```powershell
$env:PROOFLINE_ECDICT_CSV = Join-Path $env:TEMP 'proofline-ecdict-audit-20260925.csv'
$env:PROOFLINE_IPA_DICT_US = Join-Path $env:TEMP 'proofline-ipa-en_US.txt'
$env:PROOFLINE_IPA_DICT_UK = Join-Path $env:TEMP 'proofline-ipa-en_UK.txt'
py scripts/generate-exam-vocabulary.py
```

脚本的输出包含输入文件 SHA-256、每个方向的词数和排除原因，便于发布前复核。
