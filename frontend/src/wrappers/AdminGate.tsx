import { LockOutlined } from '@ant-design/icons';
import { Outlet } from '@umijs/max';
import { Alert, Button, Input, Spin, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { publicHttpsURL } from '../utils/publicHttps';

type Props = { children?: ReactNode };

export default function AdminGate({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const secureURL = publicHttpsURL(window.location);
    if (secureURL) {
      window.location.replace(secureURL);
      return;
    }
    void fetch('/api/admin/status').then((response) => {
      setReady(response.ok);
      setChecked(true);
    }).catch(() => setChecked(true));
  }, []);

  async function signIn() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError('Incorrect password / 密码错误');
        return;
      }
      setReady(true);
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (ready) {
    return <>{children ?? <Outlet />}</>;
  }
  if (!checked) {
    return <div className="access-gate-loading"><Spin size="large" /></div>;
  }

  return (
    <main className="admin-gate-page">
      <section className="admin-gate-card">
        <LockOutlined className="admin-gate-icon" />
        <Typography.Title level={1}>Administrator access / 管理员登录</Typography.Title>
        <Typography.Paragraph type="secondary">Enter the administrator password to open /om.</Typography.Paragraph>
        {error ? <Alert type="error" message={error} showIcon /> : null}
        <label className="admin-password-label" htmlFor="admin-password">Password</label>
        <Input.Password
          id="admin-password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          onPressEnter={() => { if (password) void signIn(); }}
        />
        <Button type="primary" block loading={submitting} disabled={!password} onClick={signIn}>Sign in</Button>
      </section>
    </main>
  );
}
