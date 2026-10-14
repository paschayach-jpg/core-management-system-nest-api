/**
 * ชิ้นส่วน SQL ที่ใช้ซ้ำของ RGP (พอร์ตจาก ProjectRepository / ProjectStateRepository / ProjectProgressRepository)
 * คอลัมน์ผลลัพธ์ตั้งชื่อ alias เป็น camelCase ตรงกับ DTO เพื่อไม่ต้องแมปซ้ำ
 */

/** progress ล่าสุดต่อ state = แถวที่ i_progress_id มากสุด */
export const LATEST_PROGRESS_PER_STATE = `(
    SELECT i_proj_state_id, MAX(i_progress_id) AS max_id
    FROM RGP.t_project_progress
    GROUP BY i_proj_state_id
  )`;

/** % รวมของโครงการ = ค่าเฉลี่ย % ล่าสุดของทุก state (ปัดเศษทิ้งแบบ CAST AS INT) — ใช้เป็น % ของ "โครงการอ้างอิง" */
export const PROJECT_OVERALL_PCT = `(
    SELECT rps.i_project_id,
           CAST(AVG(CAST(ISNULL(rpr.i_pct_complete, 0) AS FLOAT)) AS INT) AS i_pct_overall
    FROM RGP.t_project_state rps
    LEFT JOIN ${LATEST_PROGRESS_PER_STATE} rlp ON rlp.i_proj_state_id = rps.i_proj_state_id
    LEFT JOIN RGP.t_project_progress rpr ON rpr.i_progress_id = rlp.max_id
    GROUP BY rps.i_project_id
  )`;

/** ขั้นตอนของโครงการ + progress ล่าสุด + ข้อมูลโครงการอ้างอิง (GetStatesByProject) — พารามิเตอร์ @0 = i_project_id */
export const STATES_WITH_PROGRESS_SQL = `
SELECT ps.i_proj_state_id AS projStateId,
       ps.i_project_id AS projectId,
       ps.i_state_id AS templateStateId,
       ps.n_state_name AS name,
       ps.i_seq_no AS seqNo,
       ps.c_description AS description,
       ps.f_required AS required,
       ps.c_status AS status,
       ps.i_estimated_days AS estimatedDays,
       ps.i_ref_project_id AS refProjectId,
       ps.i_create_user AS createUser,
       ps.d_create_date AS createDate,
       ps.i_update_user AS updateUser,
       ps.d_update_date AS updateDate,
       ISNULL(pr.i_pct_complete, 0) AS pctComplete,
       ISNULL(pr.n_remark, '') AS latestRemark,
       rp.c_project_no AS refProjectNo,
       rp.n_project_name AS refProjectName,
       ISNULL(ref_st.i_pct_overall, 0) AS refPctOverall
FROM RGP.t_project_state ps
LEFT JOIN ${LATEST_PROGRESS_PER_STATE} lp ON lp.i_proj_state_id = ps.i_proj_state_id
LEFT JOIN RGP.t_project_progress pr ON pr.i_progress_id = lp.max_id
LEFT JOIN RGP.t_project rp ON rp.i_project_id = ps.i_ref_project_id AND rp.f_active = 'Y'
LEFT JOIN ${PROJECT_OVERALL_PCT} ref_st ON ref_st.i_project_id = ps.i_ref_project_id
WHERE ps.i_project_id = @0
ORDER BY ps.i_seq_no, ps.i_proj_state_id`;

/** ความคืบหน้าล่าสุดต่อขั้นตอน (GetLatestProgressByProject) — @0 = i_project_id */
export const LATEST_PROGRESS_BY_PROJECT_SQL = `
SELECT ps.i_proj_state_id AS projStateId,
       ps.i_project_id AS projectId,
       ps.n_state_name AS stateName,
       ps.i_seq_no AS seqNo,
       ps.f_required AS required,
       ps.c_status AS stateStatus,
       ISNULL(pr.c_status, 'Pending') AS status,
       ISNULL(pr.n_remark, '') AS remark,
       ISNULL(pr.i_pct_complete, 0) AS pctComplete,
       pr.d_action_date AS actionDate,
       pr.i_action_user AS actionUser,
       pr.i_progress_id AS progressId,
       ps.i_ref_project_id AS refProjectId,
       rp.c_project_no AS refProjectNo,
       rp.n_project_name AS refProjectName,
       ISNULL(ref_st.i_pct_overall, 0) AS refPctOverall
FROM RGP.t_project_state ps
LEFT JOIN ${LATEST_PROGRESS_PER_STATE} lp ON lp.i_proj_state_id = ps.i_proj_state_id
LEFT JOIN RGP.t_project_progress pr ON pr.i_progress_id = lp.max_id
LEFT JOIN RGP.t_project rp ON rp.i_project_id = ps.i_ref_project_id AND rp.f_active = 'Y'
LEFT JOIN ${PROJECT_OVERALL_PCT} ref_st ON ref_st.i_project_id = ps.i_ref_project_id
WHERE ps.i_project_id = @0
ORDER BY ps.i_seq_no, ps.i_proj_state_id`;

/** ผู้ที่ทำงานล่าสุด/จำนวน state ต่อโครงการ ใช้ในรายการค้นหาโครงการ */
export const PROJECT_STATE_SUMMARY = `(
    SELECT ps.i_project_id,
           COUNT(*) AS i_total_states,
           SUM(CASE WHEN ps.c_status = 'Completed' THEN 1 ELSE 0 END) AS i_completed_states,
           CAST(AVG(CAST(
               CASE WHEN ps.i_ref_project_id IS NOT NULL THEN ISNULL(ref_st.i_pct_overall, 0)
                    ELSE ISNULL(pr.i_pct_complete, 0) END
           AS FLOAT)) AS INT) AS i_pct_overall
    FROM RGP.t_project_state ps
    LEFT JOIN ${LATEST_PROGRESS_PER_STATE} lp ON lp.i_proj_state_id = ps.i_proj_state_id
    LEFT JOIN RGP.t_project_progress pr ON pr.i_progress_id = lp.max_id
    LEFT JOIN ${PROJECT_OVERALL_PCT} ref_st ON ref_st.i_project_id = ps.i_ref_project_id
    GROUP BY ps.i_project_id
  )`;

/** progress ล่าสุดของทั้งโครงการ (ผู้ทำ/เวลา) */
export const PROJECT_LAST_PROGRESS = `(
    SELECT pp.i_action_user, pp.d_action_date, x.i_project_id
    FROM (
        SELECT ps.i_project_id, MAX(pp.i_progress_id) AS max_id
        FROM RGP.t_project_progress pp
        JOIN RGP.t_project_state ps ON ps.i_proj_state_id = pp.i_proj_state_id
        GROUP BY ps.i_project_id
    ) x
    JOIN RGP.t_project_progress pp ON pp.i_progress_id = x.max_id
  )`;
