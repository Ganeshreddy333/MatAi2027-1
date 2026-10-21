<?php

declare(strict_types=1);

namespace MatAi;

use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;
use RuntimeException;

final class NotificationService
{
    public function __construct(private readonly Config $config)
    {
    }

    public function notifySubmission(string $kind, array $record): void
    {
        if ($this->config->get('SMTP_HOST') === '') {
            return;
        }
        $recipient = $this->config->get('ADMIN_NOTIFICATION_EMAIL');
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            OperationalLogger::event('warning', 'notification_recipient_not_configured');
            return;
        }
        $sender = $this->config->get('SMTP_FROM_ADDRESS');
        if (!filter_var($sender, FILTER_VALIDATE_EMAIL)) {
            OperationalLogger::event('warning', 'notification_sender_not_configured');
            return;
        }
        $recipients = [$recipient];
        $userEmail = $record['data']['email'] ?? '';
        if (is_string($userEmail) && filter_var($userEmail, FILTER_VALIDATE_EMAIL)) {
            $recipients[] = $userEmail;
        }
        foreach (array_unique($recipients) as $to) {
            try {
                $mail = new PHPMailer(true);
                $mail->isSMTP();
                $mail->Host = $this->config->get('SMTP_HOST');
                $mail->Port = (int) $this->config->get('SMTP_PORT', '587');
                $mail->SMTPAuth = $this->config->get('SMTP_USERNAME') !== '';
                $mail->Username = $this->config->get('SMTP_USERNAME');
                $mail->Password = $this->config->get('SMTP_PASSWORD');
                $mail->SMTPSecure = $this->config->get('SMTP_ENCRYPTION') === 'ssl'
                    ? PHPMailer::ENCRYPTION_SMTPS
                    : PHPMailer::ENCRYPTION_STARTTLS;
                $mail->CharSet = 'UTF-8';
                $mail->setFrom($sender, $this->config->get('SMTP_FROM_NAME', 'MatAi 2027'));
                $mail->addAddress($to);
                $mail->Subject = $to === $recipient
                    ? 'New MatAi 2027 ' . $kind . ' submission ' . $record['reference']
                    : 'MatAi 2027 submission received';
                $mail->Body = $to === $recipient
                    ? 'A new ' . $kind . ' submission was received. Reference: ' . $record['reference']
                    : 'Thank you. Your MatAi 2027 ' . $kind . ' submission was received. Reference: ' . $record['reference'];
                $mail->send();
                OperationalLogger::event('info', 'submission_notification_sent', ['kind' => $kind]);
            } catch (MailException | RuntimeException $error) {
                OperationalLogger::event('error', 'submission_notification_failed', [
                    'kind' => $kind,
                    'exception' => $error::class,
                ]);
            }
        }
    }
}
