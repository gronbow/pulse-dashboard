# Pulse 品牌与商标工程阶段预审

审查日期：2026-07-24  
范围：公开网页、美国 USPTO 官方检索规则说明、Apple App Store、Google Play。  
结论性质：工程阶段风险筛查，不是法律意见，也不等于正式的商标清查或注册保证。

## 结论

Pulse 作为产品内部品牌可以继续使用；但不建议在没有专业清查前，直接把 `PULSE` 单独作为健康/运动/可穿戴数据软件的唯一公开商标提交注册。

初步风险：中高到高。

原因是：

- 已经存在直接使用 `PULSE` 的运动表现产品，而且其公开页面明确称品牌受保护并已注册欧盟商标 EUTM 018965127；产品还处理 Apple Health 和多种可穿戴设备数据，并提供健康/表现报告、负荷和恢复提示。
- 另有 `Pulse: Health Insights` 这类健康数据看板产品，公开提供睡眠、HRV、静息心率、步数、运动和趋势等功能。
- 健康数据聚合、训练负荷和可穿戴分析软件本身已经是拥挤的相邻市场。即使类别编号不同，只要商品/服务和使用场景相关，也可能产生混淆判断。

因此，本仓库采用 `Pulse Dashboard` 作为产品显示名，采用厂商无关的数据源概念，并把 COROS MCP 降为可选适配器。这降低了产品与单一设备厂商的绑定，但不会自动解决 `PULSE` 作为商标的可注册性问题。

## 已发现的同类名称或产品

| 名称 | 公开信息 | 与本项目的相关性 |
|---|---|---|
| PULSE Sport | Google Play 页面显示其导入 Apple Health 和多种可穿戴数据，生成健康/运动表现报告，并声明 `PULSE` 为受保护品牌、EUTM 018965127 | 高：运动数据、可穿戴、负荷/恢复和软件服务高度相邻 |
| Pulse: Health Insights | Apple App Store 页面显示其为健康洞察看板，覆盖睡眠、HRV、静息心率、步数、运动、血氧和趋势 | 高：健康指标看板和洞察功能相似 |
| PulsHealth | 官网定位为健康数据访问、导出和趋势服务 | 中：名称近似且处于健康数据软件语境，但不是完全相同拼写 |

这些产品的存在足以说明：`Pulse` 不是一个可以仅凭普通搜索就视为“空闲”的名称。它们不等同于对中国、美国或欧盟注册结果的完整判断，仍需逐国核查实时数据库和权利状态。

## 官方审查原则

美国 USPTO 说明，商标相似且商品/服务相关时，混淆可能性是常见的驳回理由；相关商品/服务即使不在同一个类别，也可能被认为具有关联。USPTO 还明确提醒：检索结果不能保证注册，死商标也可能存在普通法层面的风险。

正式检索至少应覆盖：

1. 美国 USPTO Trademark Search 和 TSDR 的 live marks、申请记录、商品/服务描述和相关审查历史。
2. 欧盟 EUIPO / TMview 的欧盟及成员国记录。
3. 中国国家知识产权局商标网上检索，以及目标商品/服务和近似群组。
4. App Store、Google Play、GitHub、域名和社交媒体中的在先商业使用。

本轮未把中国数据库的可用性或“Pulse”在中国可注册性当作已验证事实；如果要公开发布或申请，应补充中国的正式检索和律师/商标代理人意见。

## 对本项目的建议

- 代码和产品界面可以继续使用 `Pulse Dashboard`，但对外品牌资产应同时准备一个更具显著性的组合名称或图形标识；不要仅依赖 `Pulse` 这个通用词。
- 当前桌面 Electron 应用更接近可下载软件，后续若提供在线软件服务，需分别让专业人士评估对应的商品/服务范围。类别选择不能只看编号，还要看具体描述和实际使用方式。
- 避免使用医疗诊断、治疗、疾病预防等表述；当前产品定位为 wellness / training reference。
- 正式提交前进行文字商标、图形商标、中文名、域名和应用商店名称的统一清查，并保留检索日期和结果截图。
- 若清查确认存在高相关在先权利，优先切换到更具独创性的主品牌，把 `Pulse` 降为功能名或产品系列名。

## 参考来源

- [USPTO：Likelihood of confusion](https://www.uspto.gov/trademarks/search/likelihood-confusion)
- [USPTO：Federal trademark searching](https://www.uspto.gov/trademarks/search/federal-trademark-searching)
- [Google Play：PULSE Sport](https://play.google.com/store/apps/details?id=com.pulsebv.pulse)
- [Apple App Store：Pulse: Health Insights](https://apps.apple.com/de/app/pulse-health-insights/id6766046512)
- [PulsHealth](https://pulshealth.com/)
