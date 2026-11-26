const SUPABASE_URL = "https://yavnepiupguxlxyofjbm.supabase.co";
const SUPABASE_KEY = "sb_publishable_ixQgZBF5febYtaGr6zKupw_QrDtbJHw";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
async function testConnection() {
  const { data, error } = await supabaseClient
    .from("players")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Connection error:", error.message);
  } else {
    console.log("FiLite connected to Supabase!", data);
  }
}

testConnection();

async function createPlayer(nickname) {
  const cleanName = nickname.trim();

  if (!cleanName) {
    throw new Error("Nickname cannot be empty");
  }

  const { data, error } = await supabaseClient
    .from("players")
    .insert({
      nickname: cleanName,
    })
    .select("id, nickname")
    .single();

  if (error) {
    console.error("Create player error:", error);
    throw error;
  }

  // Initialize player's stats
  const { error: statsError } = await supabaseClient
    .from("player_stats")
    .upsert(
      {
        player_id: data.id,
        total_fi: 0,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "player_id",
        ignoreDuplicates: true,
      },
    );

  if (statsError) {
    console.error("Initialize stats error:", statsError);
    throw statsError;
  }

  return data;
}

async function savePlayerProgress(playerId, totalFi) {
  if (!playerId) return;

  const { error } = await supabaseClient.from("player_stats").upsert(
    {
      player_id: playerId,
      total_fi: Math.floor(totalFi),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "player_id",
    },
  );

  if (error) {
    console.error("Save progress error:", error);
    throw error;
  }
}
