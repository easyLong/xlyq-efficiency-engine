-- 效能引擎 MySQL 8.0 建表 SQL
-- 版本: V1 MVP
-- 说明:
-- 1. 采用 CHAR(36) 存储 UUID
-- 2. 字符集统一为 utf8mb4
-- 3. 关键业务表使用软删除字段 deleted_at
-- 4. 状态字段使用 VARCHAR，由应用层控制枚举取值

CREATE DATABASE IF NOT EXISTS `efficiency_engine`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `efficiency_engine`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `ai_suggestion_actions`;
DROP TABLE IF EXISTS `feishu_sync_logs`;
DROP TABLE IF EXISTS `feishu_object_links`;
DROP TABLE IF EXISTS `requirement_quotation_mappings`;
DROP TABLE IF EXISTS `change_request_items`;
DROP TABLE IF EXISTS `change_requests`;
DROP TABLE IF EXISTS `quotation_item_dimension_rules`;
DROP TABLE IF EXISTS `quotation_items`;
DROP TABLE IF EXISTS `quotations`;
DROP TABLE IF EXISTS `weekly_reports`;
DROP TABLE IF EXISTS `ai_execution_logs`;
DROP TABLE IF EXISTS `risk_alerts`;
DROP TABLE IF EXISTS `notification_messages`;
DROP TABLE IF EXISTS `task_result_files`;
DROP TABLE IF EXISTS `task_status_histories`;
DROP TABLE IF EXISTS `task_directories`;
DROP TABLE IF EXISTS `worklogs`;
DROP TABLE IF EXISTS `tasks`;
DROP TABLE IF EXISTS `requirement_items`;
DROP TABLE IF EXISTS `requirement_versions`;
DROP TABLE IF EXISTS `requirements`;
DROP TABLE IF EXISTS `project_members`;
DROP TABLE IF EXISTS `projects`;
DROP TABLE IF EXISTS `wechat_group_configs`;
DROP TABLE IF EXISTS `source_contact_contexts`;
DROP TABLE IF EXISTS `contact_context_configs`;
DROP TABLE IF EXISTS `dimension_dictionaries`;
DROP TABLE IF EXISTS `customers`;
DROP TABLE IF EXISTS `user_roles`;
DROP TABLE IF EXISTS `roles`;
DROP TABLE IF EXISTS `users`;

CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(64) NOT NULL,
  `email` VARCHAR(128) NULL,
  `mobile` VARCHAR(32) NULL,
  `avatar_url` VARCHAR(512) NULL,
  `status` VARCHAR(32) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `feishu_open_id` VARCHAR(128) NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`),
  UNIQUE KEY `uk_users_feishu_open_id` (`feishu_open_id`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE `roles` (
  `id` CHAR(36) NOT NULL,
  `role_code` VARCHAR(32) NOT NULL,
  `role_name` VARCHAR(64) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_roles_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

CREATE TABLE `user_roles` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role_id` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_roles_user_role` (`user_id`, `role_id`),
  KEY `idx_user_roles_role_id` (`role_id`),
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

CREATE TABLE `customers` (
  `id` CHAR(36) NOT NULL,
  `customer_code` VARCHAR(32) NULL,
  `customer_name` VARCHAR(128) NOT NULL,
  `contact_name` VARCHAR(64) NULL,
  `contact_mobile` VARCHAR(32) NULL,
  `contact_email` VARCHAR(128) NULL,
  `industry` VARCHAR(64) NULL,
  `source` VARCHAR(32) NULL,
  `status` VARCHAR(32) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_customers_customer_code` (`customer_code`),
  KEY `idx_customers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

CREATE TABLE `contact_context_configs` (
  `id` CHAR(36) NOT NULL,
  `contact_name` VARCHAR(64) NOT NULL,
  `contact_mobile` VARCHAR(32) NULL,
  `contact_email` VARCHAR(128) NULL,
  `customer_id` CHAR(36) NOT NULL,
  `business_platform` VARCHAR(64) NULL,
  `business_category` VARCHAR(32) NOT NULL,
  `secondary_category` VARCHAR(64) NULL,
  `tertiary_category` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_contact_context_customer_id` (`customer_id`),
  KEY `idx_contact_context_contact_name` (`contact_name`),
  KEY `idx_contact_context_status` (`status`),
  KEY `idx_contact_context_business` (`business_platform`, `business_category`, `secondary_category`, `tertiary_category`),
  CONSTRAINT `fk_contact_context_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对接人上下文配置表';

CREATE TABLE `source_contact_contexts` (
  `id` CHAR(36) NOT NULL,
  `source_app` VARCHAR(32) NOT NULL DEFAULT 'crawler',
  `source_type` VARCHAR(32) NOT NULL,
  `source_key` CHAR(64) NOT NULL,
  `source_name` VARCHAR(255) NOT NULL,
  `external_source_id` VARCHAR(128) NULL,
  `contact_context_config_id` CHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 1,
  `priority` INT NOT NULL DEFAULT 100,
  `match_method` VARCHAR(32) NULL,
  `remark` VARCHAR(255) NULL,
  `first_seen_at` DATETIME NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_contact_context_config` (`source_app`, `source_type`, `source_key`, `contact_context_config_id`),
  KEY `idx_source_contact_source` (`source_app`, `source_type`, `source_key`),
  KEY `idx_source_contact_name` (`source_name`),
  KEY `idx_source_contact_config` (`contact_context_config_id`),
  KEY `idx_source_contact_status` (`status`),
  KEY `idx_source_contact_priority` (`source_app`, `source_type`, `source_key`, `status`, `is_primary`, `priority`),
  CONSTRAINT `fk_source_contact_context_config` FOREIGN KEY (`contact_context_config_id`) REFERENCES `contact_context_configs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采集来源与业务上下文绑定表';

CREATE TABLE `wechat_group_configs` (
  `id` CHAR(36) NOT NULL,
  `group_id` VARCHAR(128) NULL,
  `group_name` VARCHAR(255) NOT NULL,
  `source_key` CHAR(64) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `contact_context_config_id` CHAR(36) NULL,
  `business_platform` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `collect_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 100,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wechat_group_source` (`source_key`),
  UNIQUE KEY `uk_wechat_group_id` (`group_id`),
  KEY `idx_wechat_group_customer` (`customer_id`),
  KEY `idx_wechat_group_contact` (`contact_context_config_id`),
  KEY `idx_wechat_group_status_order` (`status`, `collect_enabled`, `sort_order`),
  CONSTRAINT `fk_wechat_group_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_wechat_group_contact_context` FOREIGN KEY (`contact_context_config_id`) REFERENCES `contact_context_configs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信群采集配置表';

CREATE TABLE `dimension_dictionaries` (
  `id` CHAR(36) NOT NULL,
  `dimension_type` VARCHAR(32) NOT NULL,
  `dimension_code` VARCHAR(64) NOT NULL,
  `dimension_name` VARCHAR(128) NOT NULL,
  `parent_code` VARCHAR(64) NULL,
  `sort_order` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dimension_type_code` (`dimension_type`, `dimension_code`),
  KEY `idx_dimension_type_parent` (`dimension_type`, `parent_code`),
  KEY `idx_dimension_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务维度字典表';

CREATE TABLE `projects` (
  `id` CHAR(36) NOT NULL,
  `project_code` VARCHAR(32) NOT NULL,
  `project_name` VARCHAR(128) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `project_type` VARCHAR(32) NULL,
  `status` VARCHAR(32) NOT NULL,
  `priority` VARCHAR(32) NULL,
  `budget_amount` DECIMAL(14,2) NULL,
  `start_date` DATE NULL,
  `planned_end_date` DATE NULL,
  `actual_end_date` DATE NULL,
  `description` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_projects_project_code` (`project_code`),
  KEY `idx_projects_customer_id` (`customer_id`),
  KEY `idx_projects_owner_user_id` (`owner_user_id`),
  KEY `idx_projects_status` (`status`),
  KEY `idx_projects_planned_end_date` (`planned_end_date`),
  CONSTRAINT `fk_projects_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_projects_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目表';

CREATE TABLE `project_members` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `member_role` VARCHAR(32) NOT NULL,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_members` (`project_id`, `user_id`, `member_role`),
  KEY `idx_project_members_user_id` (`user_id`),
  CONSTRAINT `fk_project_members_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_project_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员表';

CREATE TABLE `requirements` (
  `id` CHAR(36) NOT NULL,
  `requirement_code` VARCHAR(32) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `title` VARCHAR(256) NOT NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `source_ref_id` VARCHAR(128) NULL,
  `business_name` VARCHAR(128) NULL,
  `business_platform` VARCHAR(64) NULL,
  `business_category` VARCHAR(32) NULL,
  `secondary_category` VARCHAR(64) NULL,
  `tertiary_category` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL,
  `priority` VARCHAR(32) NULL,
  `raw_content` TEXT NULL,
  `summary` TEXT NULL,
  `submitted_by_user_id` CHAR(36) NULL,
  `confirmed_by_user_id` CHAR(36) NULL,
  `confirmed_at` DATETIME NULL,
  `current_version_no` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_requirements_requirement_code` (`requirement_code`),
  KEY `idx_requirements_project_id` (`project_id`),
  KEY `idx_requirements_customer_id` (`customer_id`),
  KEY `idx_requirements_status` (`status`),
  KEY `idx_requirements_source_ref` (`source_type`, `source_ref_id`),
  CONSTRAINT `fk_requirements_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_requirements_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_requirements_submitted_by` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_requirements_confirmed_by` FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求主表';

CREATE TABLE `requirement_versions` (
  `id` CHAR(36) NOT NULL,
  `requirement_id` CHAR(36) NOT NULL,
  `version_no` INT NOT NULL,
  `raw_content` TEXT NOT NULL,
  `structured_result_json` JSON NULL,
  `changed_reason` VARCHAR(255) NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_requirement_versions` (`requirement_id`, `version_no`),
  KEY `idx_requirement_versions_created_by` (`created_by`),
  CONSTRAINT `fk_requirement_versions_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirements` (`id`),
  CONSTRAINT `fk_requirement_versions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求版本表';

CREATE TABLE `requirement_items` (
  `id` CHAR(36) NOT NULL,
  `requirement_id` CHAR(36) NOT NULL,
  `parent_item_id` CHAR(36) NULL,
  `item_no` VARCHAR(64) NOT NULL,
  `item_title` VARCHAR(256) NOT NULL,
  `item_description` TEXT NULL,
  `business_goal` TEXT NULL,
  `acceptance_criteria` TEXT NULL,
  `priority` VARCHAR(32) NULL,
  `estimated_days` DECIMAL(8,2) NULL,
  `estimated_hours` DECIMAL(8,2) NULL,
  `status` VARCHAR(32) NOT NULL,
  `quote_scope_status` VARCHAR(32) NOT NULL,
  `owner_user_id` CHAR(36) NULL,
  `sort_order` INT NULL,
  `version_no` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_requirement_items_item_no` (`requirement_id`, `item_no`),
  KEY `idx_requirement_items_status` (`status`),
  KEY `idx_requirement_items_quote_scope_status` (`quote_scope_status`),
  KEY `idx_requirement_items_owner_user_id` (`owner_user_id`),
  KEY `idx_requirement_items_parent_item_id` (`parent_item_id`),
  CONSTRAINT `fk_requirement_items_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirements` (`id`),
  CONSTRAINT `fk_requirement_items_parent_item` FOREIGN KEY (`parent_item_id`) REFERENCES `requirement_items` (`id`),
  CONSTRAINT `fk_requirement_items_owner_user` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项表';

CREATE TABLE `tasks` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `requirement_item_id` CHAR(36) NULL,
  `parent_task_id` CHAR(36) NULL,
  `task_no` VARCHAR(32) NOT NULL,
  `task_name` VARCHAR(256) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(32) NOT NULL,
  `priority` VARCHAR(32) NULL,
  `assignee_user_id` CHAR(36) NULL,
  `reporter_user_id` CHAR(36) NULL,
  `planned_start_at` DATETIME NULL,
  `planned_end_at` DATETIME NULL,
  `actual_start_at` DATETIME NULL,
  `actual_end_at` DATETIME NULL,
  `estimated_hours` DECIMAL(8,2) NULL,
  `actual_hours` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `progress_percent` INT NOT NULL DEFAULT 0,
  `blocked_reason` VARCHAR(255) NULL,
  `sort_order` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tasks_task_no` (`project_id`, `task_no`),
  KEY `idx_tasks_requirement_item_id` (`requirement_item_id`),
  KEY `idx_tasks_assignee_user_id` (`assignee_user_id`),
  KEY `idx_tasks_reporter_user_id` (`reporter_user_id`),
  KEY `idx_tasks_status` (`status`),
  KEY `idx_tasks_planned_end_at` (`planned_end_at`),
  KEY `idx_tasks_parent_task_id` (`parent_task_id`),
  CONSTRAINT `fk_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_tasks_requirement_item` FOREIGN KEY (`requirement_item_id`) REFERENCES `requirement_items` (`id`),
  CONSTRAINT `fk_tasks_parent_task` FOREIGN KEY (`parent_task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_tasks_assignee_user` FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tasks_reporter_user` FOREIGN KEY (`reporter_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务表';

CREATE TABLE `task_directories` (
  `id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `assignee_user_id` CHAR(36) NULL,
  `feishu_folder_token` VARCHAR(128) NULL,
  `directory_url` VARCHAR(500) NULL,
  `permission_status` VARCHAR(32) NOT NULL,
  `last_synced_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_directories_task_id` (`task_id`),
  KEY `idx_task_directories_project_id` (`project_id`),
  KEY `idx_task_directories_assignee_user_id` (`assignee_user_id`),
  CONSTRAINT `fk_task_directories_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_task_directories_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_task_directories_assignee_user` FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务成果目录和权限表';

CREATE TABLE `task_result_files` (
  `id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `file_name` VARCHAR(256) NOT NULL,
  `file_url` VARCHAR(500) NOT NULL,
  `feishu_file_token` VARCHAR(128) NULL,
  `uploaded_by_user_id` CHAR(36) NULL,
  `source` VARCHAR(32) NOT NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_task_result_files_task_id` (`task_id`),
  KEY `idx_task_result_files_project_id` (`project_id`),
  KEY `idx_task_result_files_uploaded_by_user_id` (`uploaded_by_user_id`),
  CONSTRAINT `fk_task_result_files_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_task_result_files_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_task_result_files_uploaded_by_user` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务结果文件表';

CREATE TABLE `task_status_histories` (
  `id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `from_status` VARCHAR(32) NOT NULL,
  `to_status` VARCHAR(32) NOT NULL,
  `trigger_source` VARCHAR(64) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_task_status_histories_task_created` (`task_id`, `created_at`),
  CONSTRAINT `fk_task_status_histories_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务状态历史表';

CREATE TABLE `notification_messages` (
  `id` CHAR(36) NOT NULL,
  `recipient_user_id` CHAR(36) NULL,
  `title` VARCHAR(128) NOT NULL,
  `content` TEXT NOT NULL,
  `object_type` VARCHAR(32) NULL,
  `object_id` CHAR(36) NULL,
  `channels_json` JSON NULL,
  `delivery_result_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL,
  `sent_at` DATETIME NULL,
  `read_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notification_messages_recipient` (`recipient_user_id`, `status`),
  KEY `idx_notification_messages_object` (`object_type`, `object_id`),
  KEY `idx_notification_messages_created_at` (`created_at`),
  CONSTRAINT `fk_notification_messages_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内消息和通知投递表';

CREATE TABLE `worklogs` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `requirement_item_id` CHAR(36) NULL,
  `user_id` CHAR(36) NOT NULL,
  `work_date` DATE NOT NULL,
  `hours` DECIMAL(8,2) NOT NULL,
  `work_summary` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL,
  `approval_status` VARCHAR(32) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_worklogs_project_id` (`project_id`),
  KEY `idx_worklogs_task_id` (`task_id`),
  KEY `idx_worklogs_requirement_item_id` (`requirement_item_id`),
  KEY `idx_worklogs_user_work_date` (`user_id`, `work_date`),
  CONSTRAINT `fk_worklogs_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_worklogs_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_worklogs_requirement_item` FOREIGN KEY (`requirement_item_id`) REFERENCES `requirement_items` (`id`),
  CONSTRAINT `fk_worklogs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工时记录表';

CREATE TABLE `risk_alerts` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NULL,
  `requirement_item_id` CHAR(36) NULL,
  `alert_type` VARCHAR(32) NOT NULL,
  `severity` VARCHAR(32) NOT NULL,
  `title` VARCHAR(256) NOT NULL,
  `content` TEXT NULL,
  `status` VARCHAR(32) NOT NULL,
  `triggered_at` DATETIME NOT NULL,
  `resolved_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_risk_alerts_project_status` (`project_id`, `status`),
  KEY `idx_risk_alerts_task_id` (`task_id`),
  KEY `idx_risk_alerts_requirement_item_id` (`requirement_item_id`),
  KEY `idx_risk_alerts_alert_type` (`alert_type`),
  CONSTRAINT `fk_risk_alerts_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_risk_alerts_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_risk_alerts_requirement_item` FOREIGN KEY (`requirement_item_id`) REFERENCES `requirement_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风险预警表';

CREATE TABLE `ai_execution_logs` (
  `id` CHAR(36) NOT NULL,
  `scene_code` VARCHAR(32) NOT NULL,
  `project_id` CHAR(36) NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_id` CHAR(36) NULL,
  `input_json` JSON NULL,
  `output_json` JSON NULL,
  `model_name` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL,
  `execution_ms` INT NULL,
  `error_message` TEXT NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_execution_logs_scene_code` (`scene_code`),
  KEY `idx_ai_execution_logs_project_id` (`project_id`),
  KEY `idx_ai_execution_logs_object` (`object_type`, `object_id`),
  CONSTRAINT `fk_ai_execution_logs_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_ai_execution_logs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 执行日志表';

CREATE TABLE `weekly_reports` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `report_week` VARCHAR(16) NOT NULL,
  `title` VARCHAR(256) NOT NULL,
  `content` TEXT NULL,
  `source` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `generated_by_ai_log_id` CHAR(36) NULL,
  `sent_to_feishu_at` DATETIME NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_reports_project_week` (`project_id`, `report_week`),
  KEY `idx_weekly_reports_generated_by_ai_log_id` (`generated_by_ai_log_id`),
  KEY `idx_weekly_reports_created_by` (`created_by`),
  CONSTRAINT `fk_weekly_reports_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_weekly_reports_ai_log` FOREIGN KEY (`generated_by_ai_log_id`) REFERENCES `ai_execution_logs` (`id`),
  CONSTRAINT `fk_weekly_reports_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周报表';

CREATE TABLE `quotations` (
  `id` CHAR(36) NOT NULL,
  `quotation_no` VARCHAR(32) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `pricing_basis` VARCHAR(32) NOT NULL,
  `total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `currency_code` VARCHAR(16) NOT NULL DEFAULT 'CNY',
  `version_no` INT NOT NULL DEFAULT 1,
  `confirmed_at` DATETIME NULL,
  `settled_at` DATETIME NULL,
  `created_by` CHAR(36) NULL,
  `reviewed_by` CHAR(36) NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_quotations_quotation_no` (`quotation_no`),
  KEY `idx_quotations_project_id` (`project_id`),
  KEY `idx_quotations_customer_id` (`customer_id`),
  KEY `idx_quotations_status` (`status`),
  KEY `idx_quotations_created_by` (`created_by`),
  KEY `idx_quotations_reviewed_by` (`reviewed_by`),
  CONSTRAINT `fk_quotations_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_quotations_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_quotations_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_quotations_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价单表';

CREATE TABLE `quotation_items` (
  `id` CHAR(36) NOT NULL,
  `quotation_id` CHAR(36) NOT NULL,
  `item_code` VARCHAR(64) NOT NULL,
  `item_name` VARCHAR(128) NOT NULL,
  `pricing_mode` VARCHAR(32) NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL DEFAULT 1,
  `unit` VARCHAR(32) NULL,
  `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `line_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `source` VARCHAR(32) NOT NULL,
  `match_status` VARCHAR(32) NOT NULL,
  `sort_order` INT NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_quotation_items_item_code` (`quotation_id`, `item_code`),
  KEY `idx_quotation_items_match_status` (`match_status`),
  CONSTRAINT `fk_quotation_items_quotation` FOREIGN KEY (`quotation_id`) REFERENCES `quotations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价项表';

CREATE TABLE `quotation_item_dimension_rules` (
  `id` CHAR(36) NOT NULL,
  `quotation_item_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NULL,
  `business_platform` VARCHAR(64) NULL,
  `business_category` VARCHAR(32) NULL,
  `secondary_category` VARCHAR(64) NULL,
  `tertiary_category` VARCHAR(64) NULL,
  `priority` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_qidr_quotation_item_id` (`quotation_item_id`),
  KEY `idx_qidr_customer_id` (`customer_id`),
  KEY `idx_qidr_dimensions` (`business_category`, `secondary_category`, `tertiary_category`),
  KEY `idx_qidr_status_priority` (`status`, `priority`),
  CONSTRAINT `fk_qidr_quotation_item` FOREIGN KEY (`quotation_item_id`) REFERENCES `quotation_items` (`id`),
  CONSTRAINT `fk_qidr_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价子项维度映射规则表';

CREATE TABLE `change_requests` (
  `id` CHAR(36) NOT NULL,
  `change_no` VARCHAR(32) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `requirement_id` CHAR(36) NULL,
  `status` VARCHAR(32) NOT NULL,
  `change_type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(256) NOT NULL,
  `description` TEXT NULL,
  `impact_summary` TEXT NULL,
  `estimated_delta_amount` DECIMAL(14,2) NULL,
  `submitted_by` CHAR(36) NULL,
  `confirmed_by` CHAR(36) NULL,
  `effective_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_change_requests_change_no` (`change_no`),
  KEY `idx_change_requests_project_id` (`project_id`),
  KEY `idx_change_requests_requirement_id` (`requirement_id`),
  KEY `idx_change_requests_status` (`status`),
  CONSTRAINT `fk_change_requests_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_change_requests_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirements` (`id`),
  CONSTRAINT `fk_change_requests_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_change_requests_confirmed_by` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='变更单表';

CREATE TABLE `change_request_items` (
  `id` CHAR(36) NOT NULL,
  `change_request_id` CHAR(36) NOT NULL,
  `requirement_item_id` CHAR(36) NULL,
  `task_id` CHAR(36) NULL,
  `quotation_item_id` CHAR(36) NULL,
  `action_type` VARCHAR(32) NOT NULL,
  `before_snapshot_json` JSON NULL,
  `after_snapshot_json` JSON NULL,
  `delta_amount` DECIMAL(14,2) NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_change_request_items_cr_id` (`change_request_id`),
  KEY `idx_change_request_items_requirement_item_id` (`requirement_item_id`),
  KEY `idx_change_request_items_task_id` (`task_id`),
  KEY `idx_change_request_items_quotation_item_id` (`quotation_item_id`),
  CONSTRAINT `fk_change_request_items_cr` FOREIGN KEY (`change_request_id`) REFERENCES `change_requests` (`id`),
  CONSTRAINT `fk_change_request_items_requirement_item` FOREIGN KEY (`requirement_item_id`) REFERENCES `requirement_items` (`id`),
  CONSTRAINT `fk_change_request_items_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_change_request_items_quotation_item` FOREIGN KEY (`quotation_item_id`) REFERENCES `quotation_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='变更影响明细表';

CREATE TABLE `requirement_quotation_mappings` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `requirement_item_id` CHAR(36) NOT NULL,
  `quotation_id` CHAR(36) NULL,
  `quotation_item_id` CHAR(36) NULL,
  `mapping_status` VARCHAR(32) NOT NULL,
  `mapping_type` VARCHAR(32) NOT NULL,
  `matched_ratio` DECIMAL(5,2) NULL,
  `suggested_by_ai_log_id` CHAR(36) NULL,
  `confirmed_by` CHAR(36) NULL,
  `confirmed_at` DATETIME NULL,
  `change_request_id` CHAR(36) NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rqm_project_id` (`project_id`),
  KEY `idx_rqm_requirement_item_id` (`requirement_item_id`),
  KEY `idx_rqm_quotation_id` (`quotation_id`),
  KEY `idx_rqm_quotation_item_id` (`quotation_item_id`),
  KEY `idx_rqm_mapping_status` (`mapping_status`),
  KEY `idx_rqm_change_request_id` (`change_request_id`),
  CONSTRAINT `fk_rqm_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_rqm_requirement_item` FOREIGN KEY (`requirement_item_id`) REFERENCES `requirement_items` (`id`),
  CONSTRAINT `fk_rqm_quotation` FOREIGN KEY (`quotation_id`) REFERENCES `quotations` (`id`),
  CONSTRAINT `fk_rqm_quotation_item` FOREIGN KEY (`quotation_item_id`) REFERENCES `quotation_items` (`id`),
  CONSTRAINT `fk_rqm_ai_log` FOREIGN KEY (`suggested_by_ai_log_id`) REFERENCES `ai_execution_logs` (`id`),
  CONSTRAINT `fk_rqm_confirmed_by` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_rqm_change_request` FOREIGN KEY (`change_request_id`) REFERENCES `change_requests` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项与报价项映射表';

CREATE TABLE `feishu_object_links` (
  `id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_id` CHAR(36) NOT NULL,
  `feishu_object_type` VARCHAR(32) NOT NULL,
  `feishu_object_id` VARCHAR(128) NOT NULL,
  `sync_direction` VARCHAR(32) NOT NULL,
  `last_synced_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_feishu_object_unique` (`object_type`, `object_id`, `feishu_object_type`, `feishu_object_id`),
  KEY `idx_feishu_object_links_project_id` (`project_id`),
  KEY `idx_feishu_object_links_feishu_object` (`feishu_object_type`, `feishu_object_id`),
  CONSTRAINT `fk_feishu_object_links_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统对象与飞书对象映射表';

CREATE TABLE `feishu_sync_logs` (
  `id` CHAR(36) NOT NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_id` CHAR(36) NULL,
  `action_type` VARCHAR(32) NOT NULL,
  `feishu_object_type` VARCHAR(32) NOT NULL,
  `feishu_object_id` VARCHAR(128) NULL,
  `request_payload_json` JSON NULL,
  `response_payload_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL,
  `error_code` VARCHAR(64) NULL,
  `error_message` TEXT NULL,
  `triggered_at` DATETIME NOT NULL,
  `finished_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_feishu_sync_logs_object` (`object_type`, `object_id`),
  KEY `idx_feishu_sync_logs_status` (`status`),
  KEY `idx_feishu_sync_logs_triggered_at` (`triggered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='飞书同步日志表';

CREATE TABLE `ai_suggestion_actions` (
  `id` CHAR(36) NOT NULL,
  `ai_log_id` CHAR(36) NOT NULL,
  `action_type` VARCHAR(32) NOT NULL,
  `target_object_type` VARCHAR(32) NOT NULL,
  `target_object_id` CHAR(36) NULL,
  `action_by` CHAR(36) NULL,
  `action_at` DATETIME NOT NULL,
  `remark` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_suggestion_actions_ai_log_id` (`ai_log_id`),
  KEY `idx_ai_suggestion_actions_target` (`target_object_type`, `target_object_id`),
  KEY `idx_ai_suggestion_actions_action_by` (`action_by`),
  CONSTRAINT `fk_ai_suggestion_actions_ai_log` FOREIGN KEY (`ai_log_id`) REFERENCES `ai_execution_logs` (`id`),
  CONSTRAINT `fk_ai_suggestion_actions_action_by` FOREIGN KEY (`action_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 建议采纳记录表';

CREATE TABLE `audit_logs` (
  `id` CHAR(36) NOT NULL,
  `object_type` VARCHAR(32) NOT NULL,
  `object_id` CHAR(36) NOT NULL,
  `action_type` VARCHAR(32) NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `operator_user_id` CHAR(36) NULL,
  `operator_name` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_object` (`object_type`, `object_id`),
  KEY `idx_audit_logs_operator_user_id` (`operator_user_id`),
  KEY `idx_audit_logs_created_at` (`created_at`),
  CONSTRAINT `fk_audit_logs_operator_user` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志表';

SET FOREIGN_KEY_CHECKS = 1;
