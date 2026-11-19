-- 사용자 간 1:1 통화
-- 수신자가 SIP 에 등록돼 있지 않으면(앱이 백그라운드) svbs::wake 이벤트로 백엔드에 푸시를 요청하고
-- 등록될 때까지 링백을 들려주며 기다린 뒤 연결한다.

local callee = argv[1]
local domain = session:getVariable("domain_name")
local api = freeswitch.API()
local wake_timeout_ms = tonumber(session:getVariable("svbs_wake_timeout_ms") or "30000")

local function registered()
  local contact = api:executeString("sofia_contact */" .. callee .. "@" .. domain)
  return contact ~= nil and contact ~= "" and not string.find(contact, "error/", 1, true)
end

if not registered() then
  local e = freeswitch.Event("CUSTOM", "svbs::wake")
  e:addHeader("callee", callee)
  e:addHeader("caller", session:getVariable("svbs_extension") or session:getVariable("caller_id_number") or "")
  e:addHeader("call_uuid", session:get_uuid())
  e:fire()

  session:preAnswer()
  local started = os.time()
  while session:ready() and not registered() and (os.time() - started) * 1000 < wake_timeout_ms do
    -- 한국식 링백 (1초 울림, 2초 쉼)
    session:streamFile("tone_stream://L=1;%(1000,2000,440,480)")
  end

  if not registered() then
    if session:ready() then
      session:streamFile("tone_stream://L=3;%(500,500,480,620)")
      session:hangup("USER_NOT_REGISTERED")
    end
    return
  end
end

session:setVariable("call_timeout", "45")
session:setVariable("hangup_after_bridge", "true")
session:setVariable("continue_on_fail", "true")
session:execute("bridge", "user/" .. callee .. "@" .. domain)
