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
  <title>A gift for ${
    variables.pet_name || "you"
  } 🎁 + $100 for a 30 min chat?</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9f9f9; font-family: Arial, Helvetica, sans-serif;">
        <!-- Main content container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          
          <!-- Banner -->
          <tr>
            <td>
              <img src="https://cdn.shopify.com/s/files/1/0719/7088/1728/files/banner.png?v=1767992269" 
                   alt="InstaMe - Turn your pet photos into custom products" 
                   width="600" 
                   style="display: block; width: 100%; height: auto;">
            </td>
          </tr>
          
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 30px 40px 20px 40px;">
              <img src="https://cdn.shopify.com/s/files/1/0719/7088/1728/files/logo.png?v=1767992135" 
                   alt="InstaMe" 
                   width="120" 
                   style="display: block; height: auto;">
            </td>
          </tr>
          
          <!-- Email body -->
          <tr>
            <td style="padding: 0 40px 30px 40px; color: #333333; font-size: 16px; line-height: 1.6;">
              
              <p style="margin: 0 0 20px 0;">Hi there,</p>
              
              <p style="margin: 0 0 20px 0;">
                I'm Laly, founder of InstaMe. I wanted to reach out personally because you took the time to upload <strong>${
                  variables.pet_name || "your pet"
                }</strong>'s photo — and that means a lot to us.
              </p>
              
              <p style="margin: 0 0 20px 0;">
                I have a small favor to ask. We're a small, new team that's eager to learn from our customers. If you'd be open to a 30-minute chat to share your experience, I'd love to send you a <strong>$100 gift card</strong> to wherever you'd like — Amazon, Target, Starbucks...
              </p>
              
              <p style="margin: 0 0 20px 0;">
                It would mean the world to hear your thoughts on InstaMe! You can reply directly to this email, or book a time that works for you:
              </p>
              
              <!-- CTA Button for booking -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                <tr>
                  <td align="center" style="background-color: #98c3ae; border-radius: 8px;">
                    <a href="https://calendar.app.google/Bqn8SrhdUfm8GYwr9" 
                       style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px;">
                      Book a 30-Min Chat 📞
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px 0;">
                I hope you enjoy <strong>${
                  variables.pet_name || "your pet"
                }</strong>'s designs — looking forward to chatting with you soon! 🐾
              </p>
              
              <p style="margin: 0 0 20px 0;">
                P.S. I put together all of <strong>${
                  variables.pet_name || "your pet"
                }</strong>'s designs in high-res for you to download and keep. It is a small thank you for checking us out:
              </p>
              
              <!-- CTA Button for designs -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                <tr>
                  <td align="center" style="background-color: #98c3ae; border-radius: 8px;">
                    <a href="https://instame.co/apps/instame/images/${
                      variables.upload_id || ""
                    }" 
                       style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px;">
                      Download ${variables.pet_name || "your pet"}'s Designs 🎨
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 5px 0;">Warmly,</p>
              <p style="margin: 0 0 30px 0;"><strong>Laly</strong><br>Founder, InstaMe</p>
              
              <!-- Divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top: 1px solid #e5e5e5; padding-top: 25px;">
                    
                    <!-- P.S. Section -->
                    <p style="margin: 0 0 15px 0; color: #666666; font-size: 14px;">
                      <strong>P.S.</strong> Here's a peek at my typical workday — I'm sure you can relate to having "helpful" coworkers! 😄
                    </p>
                    
                    <!-- Workday image -->
                    <img src="https://cdn.shopify.com/s/files/1/0719/7088/1728/files/workday.png?v=1767994823" 
                         alt="Laly working with her dogs" 
                         width="520" 
                         style="display: block; width: 100%; max-width: 520px; height: auto; border-radius: 8px;">
                    
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f3f4f6; padding: 25px 40px; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #888888; font-size: 13px;">
                Made with 🐾 by InstaMe
              </p>
              <p style="margin: 0; color: #aaaaaa; font-size: 12px;">
                <a href="https://instame.co" style="color: #7c3aed; text-decoration: none;">instame.co</a>
              </p>
            </td>
          </tr>
          
        </table>
  
</body>
</html>
        `.trim(),
        text: `
Hi there,

I'm Laly, founder of InstaMe. I wanted to reach out personally because you took the time to upload ${
          variables.pet_name || "your pet"
        }'s photo — and that means a lot to us.

I have a small favor to ask. We're a small, new team that's eager to learn from our customers and find ways to improve. If you'd be open to a 30-minute chat to share your experience, I'd love to send you a $100 gift card to wherever you'd like — Amazon, Target, Starbucks, you name it.

It would mean the world to hear your thoughts and feedback on InstaMe! You can reply directly to this email, or book a time that works for you:

Book a 30-Min Chat: https://calendar.app.google/Bqn8SrhdUfm8GYwr9

I am looking forward to chatting with you soon! 🐾

P.S. I put together all of ${
          variables.pet_name || "your pet"
        }'s designs in high-res for you to download and share as a small thank you for checking us out:

Download ${
          variables.pet_name || "your pet"
        }'s Designs: https://instame.co/apps/instame/images/${
          variables.upload_id || ""
        }

Warmly,
Laly
Founder, InstaMe

Made with 🐾 by InstaMe
instame.co
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

    // Send emails individually
    for (const recipient of recipients) {
      try {
        if (!recipient.email) {
          results.failed++;
          results.errors.push(
            `Missing email for recipient: ${JSON.stringify(recipient)}`
          );
          continue;
        }

        const template = renderEmailTemplate(templateId, recipient);
        const emailSubject =
          recipient.subject || "A gift for you 🎁 + $100 for a 30 min chat?";

        const { data, error } = await resendClient.emails.send({
          from: fromEmail,
          to: recipient.email,
          subject: emailSubject,
          html: template.html,
          text: template.text,
        });

        if (error) {
          results.failed++;
          results.errors.push(
            `Failed to send to ${recipient.email}: ${error.message}`
          );
        } else {
          results.sent++;
          console.log(`✅ Email sent to ${recipient.email} (ID: ${data?.id})`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Error sending to ${recipient.email}: ${error.message}`
        );
        console.error(`❌ Error sending email to ${recipient.email}:`, error);
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
