const SUPABASE_URL = "https://yavnepiupguxlxyofjbm.supabase.co";
const SUPABASE_KEY = "sb_publishable_ixQgZBF5febYtaGr6zKupw_QrDtbJHw";

if (!window.supabase) {
  throw new Error("Supabase SDK chưa được tải!");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function isOnlineDbConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

// ===============================
// BẢO VỆ TRANG GAME
// ===============================
async function protectGamePage() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    window.location.replace("index.html");
    return;
  }

  window.currentUser = data.session.user;
}

protectGamePage();

// ===============================
// FILITE - AUTHENTICATION
// ===============================

// Đăng ký tài khoản
async function registerAccount(email, password, nickname) {
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Không thể tạo tài khoản.");
  }

  // Nếu Supabase yêu cầu xác nhận email,
  // chưa tạo hồ sơ cho đến khi người chơi xác nhận.
  if (!data.session) {
    return {
      needsEmailConfirmation: true,
      user: data.user,
    };
  }

  const { error: profileError } = await supabaseClient.from("players").insert({
    user_id: data.user.id,
    nickname: nickname,
  });

  if (profileError) {
    throw profileError;
  }

  return {
    needsEmailConfirmation: false,
    user: data.user,
  };
}

// Đăng nhập
async function loginAccount(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    throw error;
  }

  return data.user;
}

// Đăng xuất
async function logoutAccount() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    throw error;
  }
}

// Lấy tài khoản hiện tại
async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) {
    throw error;
  }

  return data.user;
}

// ===============================
// KIỂM TRA KẾT NỐI
// ===============================
async function testConnection() {
  const { data, error } = await supabaseClient
    .from("players")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Connection error:", error.message);
  } else {
    // Lưu ý: nếu RLS chặn đọc, data sẽ là [] chứ không phải lỗi.
    console.log("FiLite connected to Supabase!", data);
  }
}

testConnection();

// ===============================
// HỒ SƠ NGƯỜI CHƠI
// ===============================
async function createPlayer(nickname) {
  const cleanName = (nickname || "").trim();

  if (!cleanName) {
    throw new Error("Nickname cannot be empty");
  }

  try {
    // 1. Lấy tài khoản đang đăng nhập
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      throw new Error("Bạn cần đăng nhập trước khi tạo hồ sơ!");
    }

    // 2. Kiểm tra người chơi đã có hồ sơ chưa
    const { data: existingPlayer, error: findError } = await supabaseClient
      .from("players")
      .select("id, nickname")
      .eq("user_id", user.id)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    let player;

    if (existingPlayer) {
      // Đã có hồ sơ: sử dụng hồ sơ cũ
      player = existingPlayer;
    } else {
      // Chưa có hồ sơ: tạo hồ sơ gắn với tài khoản
      const { data, error } = await supabaseClient
        .from("players")
        .insert({
          user_id: user.id,
          nickname: cleanName,
        })
        .select("id, nickname")
        .single();

      if (error) {
        throw error;
      }

      player = data;
    }

    // 3. Khởi tạo điểm nếu chưa có
    const { error: statsError } = await supabaseClient
      .from("player_stats")
      .upsert(
        {
          player_id: player.id,
          total_fi: 0,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "player_id",
          ignoreDuplicates: true,
        },
      );

    if (statsError) {
      throw statsError;
    }

    console.log("Player profile ready:", player);

    return player;
  } catch (error) {
    console.error("Create player error:", error);
    throw error;
  }
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

// ===============================
// ĐỒNG BỘ ĐIỂM LÊN BẢNG XẾP HẠNG
// ===============================
async function syncScoreToOnline(entry) {
  try {
    // 1. Lấy người dùng đang đăng nhập
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      console.error("Người chơi chưa đăng nhập:", authError);
      return false;
    }

    // 2. Tìm hồ sơ người chơi trong bảng players
    let { data: player, error: playerError } = await supabaseClient
      .from("players")
      .select("id, nickname")
      .eq("user_id", user.id)
      .maybeSingle();

    if (playerError) {
      throw playerError;
    }

    // Chưa có hồ sơ (ví dụ đăng ký cần xác nhận email) -> tự tạo
    if (!player) {
      const fallbackName = (user.email || "player").split("@")[0].slice(0, 20);
      player = await createPlayer(fallbackName);
    }

    // 3. Chuẩn bị dữ liệu điểm
    const totalFi = Math.max(
      0,
      Math.floor(Number(entry?.total_fi ?? entry?.cash) || 0),
    );

    const playerData = {
      player_id: player.id,
      total_fi: totalFi,
      updated_at: new Date().toISOString(),
    };

    // 4. Lưu vào player_stats
    const { data, error } = await supabaseClient
      .from("player_stats")
      .upsert(playerData, {
        onConflict: "player_id",
      })
      .select();

    if (error) {
      console.error("Leaderboard sync error:", error);
      return false;
    }

    console.log("Leaderboard synced successfully!", data);
    return true;
  } catch (error) {
    console.error("Leaderboard network error:", error);
    return false;
  }
}

// ===============================
// LẤY BẢNG XẾP HẠNG
// ===============================
async function fetchOnlineLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from("player_stats")
      .select(
        `
        player_id,
        total_fi,
        updated_at,
        players (
          nickname
        )
      `,
      )
      .order("total_fi", {
        ascending: false,
      })
      .limit(30);

    if (error) {
      console.error("Leaderboard loading error:", error);
      return null;
    }

    return (data || []).map((player) => ({
      player_id: player.player_id,
      name: player.players?.nickname || "Anonymous",
      gender: null,
      level: null,
      day: null,
      cash: Number(player.total_fi) || 0,
      updated_at: player.updated_at,
    }));
  } catch (error) {
    console.error("Leaderboard error:", error);
    return null;
  }
}

async function renderGlobalLeaderboard() {
  const container = document.getElementById("globalLeaderboard");

  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-6">
      Loading leaderboard...
    </div>
  `;

  const players = await fetchOnlineLeaderboard();

  // fetchOnlineLeaderboard trả về null khi lỗi
  if (!players || !players.length) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500">
        No leaderboard data available.
      </div>
    `;
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];

  container.innerHTML = players
    .map(
      (player, index) => `
    <div class="flex items-center justify-between p-3 rounded-xl
      ${index < 3 ? "bg-amber-50 border border-amber-200" : "bg-white border border-slate-100"}
      mb-2">

      <div class="flex items-center gap-3">
        <span class="font-bold w-8 text-center">
          ${medals[index] || `#${index + 1}`}
        </span>

        <span class="font-semibold">
          ${escapeHtml(player.name)}
        </span>
      </div>

      <span class="font-bold text-emerald-600">
        ${player.cash.toLocaleString("en-US")} FI
      </span>
    </div>
  `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
