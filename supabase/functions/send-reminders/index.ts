// ═══════════════════════════════════════════════════════════
//  send-reminders — 반납 임박/연체 이메일 알림 (선택사항, P3)
//
//  이 함수는 "있으면 좋은" 확장입니다. 없어도 앱은 동작합니다.
//  (앱 안 배너 알림은 DB의 generate_reminders() + notifications 로 이미 동작합니다.)
//
//  이메일까지 보내려면:
//    1) 이메일 발송 제공자(예: Resend)에 가입해 API 키를 받습니다.
//    2) supabase secrets set RESEND_API_KEY=... FROM_EMAIL=you@yourdomain
//    3) supabase functions deploy send-reminders
//    4) DB 에서 pg_cron 으로 매일 호출하거나, 대시보드 스케줄에 등록
//
//  ⚠️ 이 함수는 service_role 로 실행되어 모든 사용자 이메일을 읽습니다.
//     반드시 Edge Function 환경변수로만 키를 두고, 클라이언트엔 두지 마세요.
// ═══════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // 🔒 서버 전용 키
  );

  // 아직 이메일로 보내지 않은(=오늘 생성된) 알림을 모읍니다.
  const today = new Date().toISOString().slice(0, 10);
  const { data: notes } = await supabase
    .from("notifications")
    .select("id,title,kind,user_id")
    .gte("created_at", today);

  if (!notes?.length) return new Response("no reminders", { status: 200 });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("FROM_EMAIL");
  if (!apiKey || !from) {
    // 키가 없으면 조용히 통과 (앱 내 배너로 이미 알림은 전달됨)
    return new Response("email not configured; skipped", { status: 200 });
  }

  // 사용자별 이메일은 auth.admin API 로 조회
  let sent = 0;
  for (const n of notes) {
    const { data: u } = await supabase.auth.admin.getUserById(n.user_id);
    const email = u?.user?.email;
    if (!email) continue;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: email,
        subject: n.kind === "overdue" ? "📕 반납일이 지났어요" : "🔔 내일까지 반납이에요",
        text: `${n.title}\n\n독서 통장에서 확인해보세요.`,
      }),
    });
    sent++;
  }
  return new Response(`sent ${sent}`, { status: 200 });
});
