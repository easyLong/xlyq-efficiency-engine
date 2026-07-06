(function attachDomainConfig(global) {
  const businessPlatforms = [
    '招行',
    '工行',
    '交行',
    '理财通',
    '蚂蚁',
    '天天基金',
    '京东金融',
  ];

  const businessCategories = [
    {
      value: 'design',
      label: '设计',
      secondaries: [
        '配图拓展',
        'banner新设计',
        '巨幅新设计',
        '长图新设计',
        '长图拓展',
        '长图套模板',
        '（其他）',
      ],
    },
    {
      value: 'copywriting',
      label: '文案',
      secondaries: [
        '数据更新',
        '已有素材新编辑',
        '原创文案',
        '共建文案',
        '（其他）',
      ],
    },
    {
      value: 'operation',
      label: '运营',
      secondaries: [
        '发布陪伴',
        '活动配置',
        '魔秀搭建',
        '页面推厂',
        '直播配置',
        '（其他）',
      ],
    },
    {
      value: 'community',
      label: '社区',
      secondaries: ['粉丝投放', '精华贴', '氛围贴', '（其他）'],
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
      value: 'copywriting',
      label: '文案',
      budgetAmount: '180000',
      description: '数据更新、已有素材编辑、原创与共建文案。',
    },
    {
      value: 'operation',
      label: '运营',
      budgetAmount: '220000',
      description: '发布陪伴、活动配置、魔秀搭建、页面推厂和直播配置。',
    },
    {
      value: 'community',
      label: '社区',
      budgetAmount: '160000',
      description: '粉丝投放、精华贴、氛围贴等社区服务。',
    },
  ];

  global.XlyqDomainConfig = {
    businessPlatforms,
    businessCategories,
    projectTypes,
  };
})(window);
