import express from "express";
import { Resend } from "resend";

const router = express.Router();

// Lazy initialization of Resend client (after dotenv has loaded)
let resend = null;

function getResendClient() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

// Email template renderer
function renderEmailTemplate(templateId, variables) {
  switch (templateId) {
    case "call_reward":
      return {
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #333333;">

<p>Hi there,</p>

<p>I'm Laly Luo, founder of InstaMe. This is a personal reach out — thank you so much for sharing a photo of <strong>${variables.pet_name || "your pet"}</strong> with us.</p>

<p>We're a new company and genuinely want to learn about our users' experiences so we can keep improving. Would you be open to a quick 30-minute phone call to share your thoughts? We're offering $60 as a thank you for your time.</p>

<p>If you're interested, just reply to this email and we can find a time that works for you.</p>

<p>Thanks again,<br>
Laly Luo<br>
Founder, InstaMe</p>

<p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666666; font-size: 14px;">
P.S. Here's a peek at my typical workday — I'm sure you can relate to having "helpful" coworkers!
</p>

<img src="https://cdn.shopify.com/s/files/1/0719/7088/1728/files/workday.png?v=1767994823" 
     alt="Laly working with her dogs" 
     width="400" 
     style="display: block; max-width: 100%; height: auto; border-radius: 8px; margin-top: 15px;">

</body>
</html>
        `.trim(),
        text: `
Hi there,

I'm Laly Luo, founder of InstaMe. This is a personal reach out — thank you so much for sharing a photo of ${variables.pet_name || "your pet"} with us.

We're a new company and genuinely want to learn about our users' experiences so we can keep improving. Would you be open to a quick 30-minute phone call to share your thoughts? We're offering $60 as a thank you for your time.

If you're interested, just reply to this email and we can find a time that works for you.

Thanks again,
Laly Luo
Founder, InstaMe

P.S. Here's a peek at my typical workday — I'm sure you can relate to having "helpful" coworkers!
        `.trim(),
      };
    default:
      throw new Error(`Unknown template: ${templateId}`);
  }
}

// Preview email template endpoint
router.post("/preview", async (req, res) => {
  try {
    const { templateId, sampleData } = req.body;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: "Template ID is required",
      });
    }

    const variables = sampleData || {
      pet_name: "Sample Pet",
      upload_id: "sample-123",
    };

    const template = renderEmailTemplate(templateId, variables);

    res.json({
      success: true,
      html: template.html,
    });
  } catch (error) {
    console.error("❌ Error in email preview endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send emails endpoint
router.post("/send", async (req, res) => {
  try {
    const { recipients, templateId } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Recipients array is required and must not be empty",
      });
    }

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: "Template ID is required",
      });
    }

    const resendClient = getResendClient();
    if (!process.env.RESEND_API_KEY || !resendClient) {
      return res.status(500).json({
        success: false,
        error:
          "RESEND_API_KEY is not configured. Please add it to your .env.local or .env file in the root directory, or local-api/.env file",
      });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const results = {
      sent: 0,
      failed: 0,
      errors: [],
    };

    // Helper function to send email with retry logic
    const sendEmailWithRetry = async (recipient, maxRetries = 3) => {
      const template = renderEmailTemplate(templateId, recipient);
      const emailSubject =
        recipient.subject || "A gift for you 🎁 + $100 for a 30 min chat?";

      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: recipient.email,
            subject: emailSubject,
            html: template.html,
            text: template.text,
          });

          if (error) {
            lastError = error;

            // Check if it's a rate limit error
            const isRateLimit =
              error.message?.includes("rate limit") ||
              error.message?.includes("Too many requests") ||
              error.statusCode === 429;

            if (isRateLimit && attempt < maxRetries) {
              // Wait longer for rate limit errors (2 seconds)
              const waitTime = 2000;
              console.log(
                `⏳ Rate limit hit for ${recipient.email}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              continue;
            }

            // If not rate limit or last attempt, log and break
            if (attempt === maxRetries) {
              console.error(
                `❌ Failed to send to ${recipient.email} after ${maxRetries} attempts: ${error.message}`
              );
            } else {
              console.log(
                `⚠️  Attempt ${attempt}/${maxRetries} failed for ${recipient.email}: ${error.message}`
              );
            }

            // If not rate limit, wait a bit before retry
            if (!isRateLimit && attempt < maxRetries) {
              const waitTime = 1000 * attempt; // Exponential backoff: 1s, 2s, 3s
              console.log(
                `⏳ Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries} for ${recipient.email}`
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
          } else {
            // Success!
            console.log(
              `✅ Email sent to ${recipient.email} (ID: ${data?.id}, attempt ${attempt})`
            );
            return { success: true, data };
          }
        } catch (error) {
          lastError = error;
          console.error(
            `❌ Exception on attempt ${attempt}/${maxRetries} for ${recipient.email}:`,
            error.message
          );

          if (attempt < maxRetries) {
            const waitTime = 1000 * attempt;
            console.log(
              `⏳ Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      // All retries failed
      return { success: false, error: lastError };
    };

    // Send emails individually with rate limiting (500ms delay = max 2 req/sec)
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];

      try {
        if (!recipient.email) {
          results.failed++;
          results.errors.push(
            `Missing email for recipient: ${JSON.stringify(recipient)}`
          );
          continue;
        }

        console.log(
          `📧 Sending email ${i + 1}/${recipients.length} to ${recipient.email}`
        );
        const result = await sendEmailWithRetry(recipient);

        if (result.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(
            `Failed to send to ${recipient.email} after 3 attempts: ${result.error?.message || "Unknown error"}`
          );
        }

        // Rate limiting: wait 500ms between sends (allows max 2 req/sec)
        if (i < recipients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Error sending to ${recipient.email}: ${error.message}`
        );
        console.error(
          `❌ Unexpected error sending email to ${recipient.email}:`,
          error
        );
      }
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error("❌ Error in email send endpoint:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
