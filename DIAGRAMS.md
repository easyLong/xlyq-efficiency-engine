# 效能引擎 ER 图与模块关系图

## 1. 说明

本文档使用 Mermaid 描述效能引擎的核心实体关系和模块协作关系，可直接用于评审、Wiki 或后续补充架构设计。

## 2. 核心 ER 图

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : assigned
    CUSTOMERS ||--o{ PROJECTS : owns
    USERS ||--o{ PROJECTS : manages
    PROJECTS ||--o{ PROJECT_MEMBERS : includes
    USERS ||--o{ PROJECT_MEMBERS : joins

    PROJECTS ||--o{ REQUIREMENTS : contains
    CUSTOMERS ||--o{ REQUIREMENTS : submits
    REQUIREMENTS ||--o{ REQUIREMENT_VERSIONS : versions
    REQUIREMENTS ||--o{ REQUIREMENT_ITEMS : splits
    USERS ||--o{ REQUIREMENT_ITEMS : owns

    REQUIREMENT_ITEMS ||--o{ TASKS : generates
    USERS ||--o{ TASKS : assigned
    TASKS ||--o{ WORKLOGS : logs
    USERS ||--o{ WORKLOGS : records

    PROJECTS ||--o{ RISK_ALERTS : triggers
    PROJECTS ||--o{ WEEKLY_REPORTS : outputs

    PROJECTS ||--o{ QUOTATIONS : has
    QUOTATIONS ||--o{ QUOTATION_ITEMS : contains
    REQUIREMENT_ITEMS ||--o{ REQUIREMENT_QUOTATION_MAPPINGS : maps
    QUOTATION_ITEMS ||--o{ REQUIREMENT_QUOTATION_MAPPINGS : maps

    PROJECTS ||--o{ CHANGE_REQUESTS : owns
    CHANGE_REQUESTS ||--o{ CHANGE_REQUEST_ITEMS : details
    REQUIREMENT_ITEMS ||--o{ CHANGE_REQUEST_ITEMS : affects
    TASKS ||--o{ CHANGE_REQUEST_ITEMS : affects
    QUOTATION_ITEMS ||--o{ CHANGE_REQUEST_ITEMS : affects

    PROJECTS ||--o{ FEISHU_OBJECT_LINKS : syncs
    PROJECTS ||--o{ AI_EXECUTION_LOGS : drives
    AI_EXECUTION_LOGS ||--o{ AI_SUGGESTION_ACTIONS : records
    USERS ||--o{ AUDIT_LOGS : operates
```

## 3. 核心业务链路图

```mermaid
flowchart LR
    A[客户需求<br/>飞书文档/消息/手工录入]
    B[需求管理<br/>Requirement]
    C[需求项拆解<br/>RequirementItem]
    D[任务生成与分配<br/>Task]
    E[执行与工时记录<br/>Worklog]
    F[进度跟进与风险预警<br/>RiskAlert/WeeklyReport]
    G[需求报价适配<br/>RequirementQuotationMapping]
    H[报价单草稿<br/>Quotation/QuotationItem]
    I[财务审核与确认]
    J[结算与经营分析]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    C --> G
    E --> G
    G --> H
    H --> I
    I --> J
```

## 4. 模块关系图

```mermaid
flowchart TB
    subgraph Input["输入层"]
      FEI[飞书文档/消息/任务]
      MANUAL[手工录入]
      IMPORT[模板导入]
    end

    subgraph Core["核心业务层"]
      PM[项目管理]
      RM[需求管理]
      TM[任务管理]
      FM[项目跟进]
      QM[需求报价适配]
      BM[报价与结算]
    end

    subgraph AI["AI 能力层"]
      AI1[需求解析]
      AI2[任务分配建议]
      AI3[风险识别]
      AI4[周报生成]
      AI5[报价适配建议]
      AI6[报价草稿建议]
    end

    subgraph Integration["集成层"]
      FSYNC[飞书同步]
      FBOT[飞书机器人]
      FHOOK[飞书事件回调]
    end

    subgraph Data["数据与审计层"]
      DB[(MySQL)]
      AUDIT[审计日志]
      AILOG[AI执行日志]
      FSLOG[飞书同步日志]
    end

    FEI --> RM
    MANUAL --> RM
    IMPORT --> RM

    PM --> RM
    RM --> TM
    TM --> FM
    RM --> QM
    TM --> QM
    QM --> BM

    AI1 --> RM
    AI2 --> TM
    AI3 --> FM
    AI4 --> FM
    AI5 --> QM
    AI6 --> BM

    FSYNC <--> RM
    FSYNC <--> TM
    FBOT --> FM
    FBOT --> BM
    FHOOK --> FSYNC

    PM --> DB
    RM --> DB
    TM --> DB
    FM --> DB
    QM --> DB
    BM --> DB

    RM --> AUDIT
    TM --> AUDIT
    QM --> AUDIT
    BM --> AUDIT
    AI1 --> AILOG
    AI3 --> AILOG
    AI5 --> AILOG
    Integration --> FSLOG
```

## 5. 需求报价适配专题图

这是本项目最关键的断层修复模块。

```mermaid
flowchart LR
    R1[需求项]
    R2[任务]
    R3[工时]
    M[适配引擎<br/>规则 + AI]
    Q1[报价项建议]
    Q2[财务确认]
    Q3[正式报价单]
    C1[变更单]

    R1 --> M
    R2 --> M
    R3 --> M
    M --> Q1
    Q1 --> Q2
    Q2 --> Q3
    R1 --> C1
    C1 --> M
```

## 6. 后端服务建议关系图

如果后端后续拆分模块，可以按下面的服务边界组织。

```mermaid
flowchart LR
    GW[API Gateway / BFF]
    AUTH[Auth Service]
    PROJ[Project Service]
    REQ[Requirement Service]
    TASK[Task Service]
    QUOTE[Quote Service]
    CHANGE[Change Service]
    FEISHU[Feishu Integration Service]
    AIAPP[AI Orchestration Service]
    REPORT[Report Service]
    DB[(MySQL)]

    GW --> AUTH
    GW --> PROJ
    GW --> REQ
    GW --> TASK
    GW --> QUOTE
    GW --> CHANGE
    GW --> FEISHU
    GW --> AIAPP
    GW --> REPORT

    PROJ --> DB
    REQ --> DB
    TASK --> DB
    QUOTE --> DB
    CHANGE --> DB
    REPORT --> DB
    FEISHU --> DB
    AIAPP --> DB

    REQ --> AIAPP
    TASK --> AIAPP
    QUOTE --> AIAPP
    FEISHU --> REQ
    FEISHU --> TASK
    FEISHU --> REPORT
    CHANGE --> QUOTE
```

## 7. 建议阅读顺序

1. 先看“核心业务链路图”
2. 再看“需求报价适配专题图”
3. 然后看“核心 ER 图”
4. 最后结合 [DB_SCHEMA.md](C:/Code/xlyq-efficiency-engine/DB_SCHEMA.md) 和 [API_SPEC.md](C:/Code/xlyq-efficiency-engine/API_SPEC.md) 进入开发
