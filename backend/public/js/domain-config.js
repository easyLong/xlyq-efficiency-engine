(function attachDomainConfig(global) {
  const businessPlatforms = [
    '招行',
    '工行',
    '交行',
    '理财通',
    '蚂蚁',
    '天天基金',
    '京东金融',
    '其它',
  ];

  const businessCategories = [
    {
      value: 'design',
      label: '设计',
      secondaries: [
        '海报', '长图', 'Banner', '图标',
      ],
    },
    {
      value: 'operation',
      label: '运营',
      secondaries: [
        '内容发布',
        '活动运营',
        '陪伴运营',
        '后台配置',
        '审核提报',
        '客户服务',
        '项目协同',
        '社区运营',
        '直播运营',
      ],
    },
    {
      value: 'content',
      label: '内容',
      secondaries: [
        '产品/行情内容', '社区/活动内容', '直播/视频脚本', '视觉/短文案',
        'PPT/方案材料', '数据处理', '文案修改/审核', '产品征信卡片',
      ],
    },
  ];

  const projectTypes = [
    {
      value: 'design',
      label: '设计',
      budgetAmount: '300000',
      description: '配图、banner、巨幅、长图与模板类设计服务。',
    },
    {
      value: 'operation',
      label: '运营',
      budgetAmount: '220000',
      description: '内容发布、活动运营、陪伴运营、后台配置及项目协同服务。',
    },
    {
      value: 'content',
      label: '内容',
      budgetAmount: '180000',
      description: '产品、活动、直播、视频、短文案、PPT及数据处理内容。',
    },
  ];

  global.XlyqDomainConfig = {
    businessPlatforms,
    businessCategories,
    projectTypes,
  };
})(window);
