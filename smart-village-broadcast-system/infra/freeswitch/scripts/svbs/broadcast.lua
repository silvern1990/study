-- 방송 재생: bcast-{id}
-- 백엔드가 방송 시작 시 mod_hash 에 svbs/bcast_{id} = 녹음 파일 경로 를 넣어둔다.
-- 종료 시 CHANNEL_HANGUP_COMPLETE 이벤트의 채널 변수로 결과를 백엔드에 알린다:
--   svbs_broadcast_id, svbs_listened_full, svbs_play_count

local broadcast_id = argv[1]
local api = freeswitch.API()

local file = api:executeString("hash select/svbs/bcast_" .. broadcast_id)
if file == nil or file == "" or string.sub(file, 1, 4) == "-ERR" then
  freeswitch.consoleLog("WARNING", "[svbs] unknown or finished broadcast " .. broadcast_id .. "\n")
  session:hangup("UNALLOCATED_NUMBER")
  return
end

local max_plays = tonumber(session:getVariable("svbs_max_plays") or "3")

-- answer 전에 설정해야 CHANNEL_ANSWER 이벤트에도 포함된다
session:setVariable("svbs_broadcast_id", broadcast_id)
session:setVariable("svbs_listened_full", "false")
session:setVariable("svbs_play_count", "0")
session:setVariable("playback_terminators", "none")

session:answer()
session:sleep(700)

local plays = 0
while session:ready() do
  -- 딩동
  session:streamFile("tone_stream://%(300,50,880);%(400,0,660)")
  session:streamFile(file)
  if not session:ready() then break end

  plays = plays + 1
  session:setVariable("svbs_play_count", tostring(plays))
  session:setVariable("svbs_listened_full", "true")
  if plays >= max_plays then break end

  -- 다시 들으려면 1번 (짧은 비프 후 5초 대기)
  -- TODO: 안내 멘트 음성 파일로 교체 ("다시 들으시려면 1번을 누르세요")
  local digit = session:read(1, 1, "tone_stream://%(150,0,1000)", 5000, "#")
  if digit ~= "1" then break end
end

if session:ready() then
  session:sleep(300)
  session:hangup("NORMAL_CLEARING")
end
