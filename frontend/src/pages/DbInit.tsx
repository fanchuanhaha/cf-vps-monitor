import React from 'react';
import { Badge, Box, Card, Flex, Heading, Separator, Text } from '@radix-ui/themes';
import { Database } from 'lucide-react';

type InitInfo = {
  ok: boolean;
  project_ref?: string | null;
  migration_count?: number;
};

export default function DbInit() {
  const [info, setInfo] = React.useState<InitInfo | null>(null);

  React.useEffect(() => {
    fetch('/api/setup/database/init')
      .then((response) => response.json())
      .then(setInfo)
      .catch(() => setInfo({ ok: false }));
  }, []);

  return (
    <div className="login-page db-init-page">
      <Card className="login-card db-init-card" style={{ padding: '32px' }}>
        <Flex direction="column" align="center" gap="2" mb="5">
          <Box className="login-logo">
            <Database size={32} color="white" />
          </Box>
          <Heading size="6">初始化数据库</Heading>
          <Text size="2" color="gray" align="center">
            D1 数据库迁移在部署时通过 wrangler d1 migrations apply 自动执行，无需手动操作。
          </Text>
        </Flex>

        <Separator size="4" mb="4" />

        <Flex className="db-init-meta" gap="2" wrap="wrap" mb="4">
          <Badge color={info?.ok ? 'green' : 'red'} variant="soft">
            项目: {info?.project_ref || '未识别'}
          </Badge>
          <Badge color="gray" variant="soft">
            迁移: {info?.migration_count ?? '-'}
          </Badge>
        </Flex>

        <Flex direction="column" gap="4" align="center">
          <Text size="2" color="gray" align="center">
            D1 数据库迁移在部署时通过 wrangler d1 migrations apply 自动执行，无需手动操作。
          </Text>
        </Flex>
      </Card>
    </div>
  );
}
