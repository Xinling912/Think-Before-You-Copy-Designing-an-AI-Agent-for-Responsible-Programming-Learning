import { Button, Checkbox, Spin, Typography, message } from 'antd';
import { Outlet } from '@umijs/max';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { publicHttpsURL } from '../utils/publicHttps';

type Props = { children?: ReactNode };

export default function ParticipantGate({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const secureURL = publicHttpsURL(window.location);
    if (secureURL) {
      window.location.replace(secureURL);
      return;
    }
    void fetch('/api/participant/status')
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok && payload.authenticated) {
          setReady(true);
          return;
        }
        setConsentRequired(Boolean(payload.consent_required));
      })
      .catch(() => message.error('Unable to start the participant session.'));
  }, []);

  async function acceptConsent() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/participant/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      if (!response.ok) {
        throw new Error('consent_failed');
      }
      setReady(true);
    } catch {
      message.error('Consent could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (ready) {
    return <>{children ?? <Outlet />}</>;
  }
  if (!consentRequired) {
    return <div className="access-gate-loading"><Spin size="large" /></div>;
  }

  const consentItems = [
    'I have read and understood the study information and agree to participate. / 我已阅读并理解本研究说明，并同意参与。',
    'I understand that my interactions will be used for academic research only and will be anonymized. / 我知晓我的交互记录将仅用于学术研究，并会以匿名形式处理。',
    'I understand that I can stop using the system at any time without any consequences. / 我了解我可以随时停止使用本系统，而无需承担任何后果。',
  ];

  return (
    <main className="consent-page">
      <section className="consent-card">
        <div className="consent-index">01</div>
        <Typography.Title level={1}>Consent Form / 知情同意说明</Typography.Title>
        <div className="consent-copy">
          <p>Before participating in this system experience, please read the following information and confirm your consent.</p>
          <p>在参与本系统体验之前，请您阅读以下说明并确认您的同意。</p>
          <p>This study aims to understand students&apos; experience and perceptions of using AI tools for programming learning. The experience will take approximately 20 minutes.</p>
          <p>本研究旨在了解学生使用 AI 工具进行编程学习的体验与看法。本次体验大约需要 20 分钟。</p>
          <p>Normal conversations with the AI, generated test questions, your answers, correctness, progress, token usage, and event times will be recorded for academic research and processed anonymously. Your identity will not be disclosed.</p>
          <p>您与 AI 的正常对话、生成的测试题、您的作答、正确性、学习进度、Token 用量及事件时间将被记录，仅用于学术研究并以匿名形式处理，不会泄露您的个人身份。</p>
          <p>Your participation is completely voluntary. You may stop using the system at any time without any negative consequences.</p>
          <p>您的参与完全自愿，您可以在任何时候停止使用本系统，而不会产生任何不利影响。</p>
        </div>
        <div className="consent-checks">
          {consentItems.map((label, index) => (
            <Checkbox
              key={label}
              checked={checks[index]}
              onChange={(event) => setChecks((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))}
            >
              {label}
            </Checkbox>
          ))}
        </div>
        <Button type="primary" size="large" disabled={!checks.every(Boolean)} loading={submitting} onClick={acceptConsent}>
          Agree and continue / 同意并继续
        </Button>
      </section>
    </main>
  );
}
