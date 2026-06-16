// Client-side email sending via EmailJS (same account the Email Center uses).
const EMAILJS_SERVICE = 'service_pt7xkma'
const EMAILJS_TEMPLATE = 'template_9zgrhkb'
const EMAILJS_PUBLIC_KEY = 'kLZVT1yzwlXV3hua6'
export const BNJ_EMAIL = 'bricknjoy@gmail.com'

export async function sendEmailJS(to, subject, message, replyTo = BNJ_EMAIL) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE,
      template_id: EMAILJS_TEMPLATE,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: to,
        subject,
        message,
        reply_to: replyTo,
        name: "Brick's & Joy",
        email: BNJ_EMAIL,
      },
    }),
  })
  if (!res.ok) throw new Error(await res.text())
}
