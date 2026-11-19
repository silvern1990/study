-- 관리자 전화 녹음: *700
-- 비프 후 녹음 시작, # 을 누르거나 5초 이상 조용하면 종료 (최대 5분).
-- 끝나면 svbs::recorded 이벤트로 백엔드에 알려 Recording 을 생성한다.

if session:getVariable("svbs_role") ~= "admin" then
  session:hangup("CALL_REJECTED")
  return
end

local extension = session:getVariable("svbs_extension") or "unknown"
local dir = session:getVariable("svbs_recordings_dir") or "/recordings"
local path = dir .. "/phone/" .. extension .. "-" .. os.date("%Y%m%d%H%M%S") .. ".wav"

session:answer()
session:sleep(500)
session:setVariable("playback_terminators", "#")

-- TODO: 안내 멘트 ("삐 소리 후 말씀하시고 끝나면 # 을 누르세요")
session:streamFile("tone_stream://%(600,0,1000)")
-- recordFile(경로, 최대초, 무음 임계값, 무음 지속초)
session:recordFile(path, 300, 200, 5)

local f = io.open(path, "rb")
if f then
  local size = f:seek("end")
  f:close()
  if size and size > 1024 then
    local e = freeswitch.Event("CUSTOM", "svbs::recorded")
    e:addHeader("extension", extension)
    e:addHeader("file", path)
    e:fire()
    if session:ready() then
      session:streamFile("tone_stream://%(200,100,1000);%(200,0,1000)")
    end
  end
end

if session:ready() then
  session:hangup("NORMAL_CLEARING")
end
