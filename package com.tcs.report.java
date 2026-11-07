package com.tcs.report.reportApiServlet;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintWriter;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import com.tcs.base.helpers.Applications;
import com.tcs.base.interfaces.IUser;
import com.tcs.common.ReportConstantJsf;
import com.tcs.fa.common.util.FAConstants;
import com.tcs.logger.LogManager;
import com.tcs.report.scheduler.DBManager;
import com.tcs.utilities.Utilities;

/**
 * Snapshot share links for LLM consumption.
 *
 * POST /LlmShare (LK + JSON body) -> creates a link, returns {url, expiresAt,
 * rowCount}
 * GET /LlmShare?t=<token> -> serves the snapshot as JSON (no login)
 * GET /LlmShare?t=<token>&format=md -> same snapshot as a plain markdown table
 * POST /LlmShare (LK + revokeToken) -> kills a link
 *
 * The token is the only credential on the read path, so it must stay
 * unguessable
 * and short lived: <orgId>-<43 base64url chars>.
 */
public class LlmShareServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    /* one entry per screen allowed to publish a snapshot */
    private static final Map<String, String> SCREENS = new HashMap<String, String>();
    static {
        SCREENS.put("autoPaymentReport.an", "Auto Payment Voucher Report");
    }

    private static final int MAX_ROWS = 5000;
    private static final int MAX_BODY_CHARS = 4000000;
    private static final int MAX_PAYLOAD_CHARS = 2000000;
    private static final int MAX_CRITERIA_CHARS = 4000;
    private static final int MIN_TTL_MINUTES = 15;
    private static final int MAX_TTL_MINUTES = 10080; /* 7 days */
    private static final int DEFAULT_TTL_MINUTES = 1440;
    private static final int MAX_ACTIVE_LINKS_PER_USER = 20;
    private static final int MD_MAX_ROWS = 200;
    private static final int TOKEN_RANDOM_BYTES = 32; /* 256 bit -> 43 base64url chars */

    private static final Pattern TOKEN_PATTERN = Pattern.compile("^(\\d{1,18})-([A-Za-z0-9_-]{43})$");
    private static final SecureRandom RANDOM = new SecureRandom();

    /* ------------------------------------------------------------------ GET */

    @Override
    protected void doGet(HttpServletRequest pRequest, HttpServletResponse pResponse) throws IOException {
        String lToken = pRequest.getParameter("t");
        if (!Utilities.hasValue(lToken)) {
            writeJson(pResponse, 400, error("Pass ?t=<token>, or POST with LK to create a link."));
            return;
        }
        serve(pRequest, pResponse, lToken);
    }

    /* ----------------------------------------------------------------- POST */

    @Override
    protected void doPost(HttpServletRequest pRequest, HttpServletResponse pResponse) throws IOException {
        String lToken = pRequest.getParameter("t");
        if (Utilities.hasValue(lToken)) {
            serve(pRequest, pResponse, lToken);
            return;
        }
        if (Utilities.hasValue(pRequest.getParameter("revokeToken"))) {
            revoke(pRequest, pResponse);
            return;
        }
        create(pRequest, pResponse);
    }

    /* --------------------------------------------------------------- CREATE */

    private void create(HttpServletRequest pRequest, HttpServletResponse pResponse) throws IOException {
        IUser lUser = loggedInUser(pRequest);
        if (lUser == null) {
            writeJson(pResponse, 401, error("Login required to create a link."));
            return;
        }

        JSONObject lBody;
        try {
            pRequest.setCharacterEncoding("UTF-8");
            lBody = new JSONObject(readBody(pRequest));
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare create: bad body", e);
            writeJson(pResponse, 400, error("Body must be a JSON object."));
            return;
        }

        String lScreen = lBody.has("screen") ? lBody.getString("screen") : "";
        if (!SCREENS.containsKey(lScreen)) {
            writeJson(pResponse, 400, error("Unsupported screen."));
            return;
        }

        JSONArray lRows = lBody.has("rows") ? lBody.optJSONArray("rows") : null;
        if (lRows == null || lRows.length() == 0) {
            writeJson(pResponse, 400, error("No rows to share."));
            return;
        }
        if (lRows.length() > MAX_ROWS) {
            writeJson(pResponse, 400, error("Result too large to share (" + lRows.length()
                    + " rows, max " + MAX_ROWS + "). Narrow the search and search again."));
            return;
        }

        JSONArray lColumns = lBody.has("columns") ? lBody.optJSONArray("columns") : null;
        if (lColumns == null || lColumns.length() == 0) {
            writeJson(pResponse, 400, error("Columns missing."));
            return;
        }

        String lCriteria = "{}";
        if (lBody.has("criteria") && lBody.optJSONObject("criteria") != null) {
            lCriteria = lBody.optJSONObject("criteria").toString();
            if (lCriteria.length() > MAX_CRITERIA_CHARS) {
                /* a truncated JSON string would never parse again on the read path */
                lCriteria = "{}";
            }
        }

        /*
         * type each column once, at create time, so the read path stays a single select
         */
        JSONObject lSnapshot = new JSONObject();
        lSnapshot.put("columns", withTypes(lColumns, lRows));
        lSnapshot.put("rows", lRows);

        String lPayload = lSnapshot.toString();
        if (lPayload.length() > MAX_PAYLOAD_CHARS) {
            writeJson(pResponse, 400, error("Result too large to share. Narrow the search and search again."));
            return;
        }

        int lTtl = clampTtl(lBody.has("ttlMinutes") ? lBody.optInt("ttlMinutes", DEFAULT_TTL_MINUTES)
                : DEFAULT_TTL_MINUTES);

        String lToken = newToken(lUser.getOrganizationId());
        Connection con = null;
        PreparedStatement lInsert = null;
        PreparedStatement lSelect = null;
        PreparedStatement lCount = null;
        ResultSet lRs = null;
        try {
            /* master connection: the read path uses the slave, writes must not */
            con = DBManager.getOrganizationConnectionForGSTScheduler(lUser.getOrganizationId());
            if (con == null) {
                writeJson(pResponse, 503, error("Database unavailable."));
                return;
            }

            lCount = con.prepareStatement("select count(fsslid) from fnascreensharelink "
                    + "where fssluserid = ? and fsslorgid = ? and fsslrowstate > -1 and fsslexpirydate > now()");
            lCount.setLong(1, lUser.getId());
            lCount.setLong(2, lUser.getOrganizationId());
            lCount.setQueryTimeout(ReportConstantJsf.QUERY_TIME_OUT_SECONDS);
            lRs = lCount.executeQuery();
            if (lRs.next() && lRs.getInt(1) >= MAX_ACTIVE_LINKS_PER_USER) {
                writeJson(pResponse, 429, error("Too many active links. Revoke one first."));
                return;
            }
            close(null, lRs, lCount);
            lRs = null;
            lCount = null;

            /* expiry comes from the database clock so app nodes cannot disagree */
            lInsert = con.prepareStatement("insert into fnascreensharelink (fssltoken, fsslorgid, fssluserid, "
                    + "fsslscreen, fsslscreenlabel, fsslcriteriainfo, fsslpayload, fsslrowcount, "
                    + "fsslcreateddate, fsslexpirydate, fsslrowstate) "
                    + "values (?,?,?,?,?,?,?,?,now(),date_add(now(), interval " + lTtl + " minute),1)");
            lInsert.setString(1, lToken);
            lInsert.setLong(2, lUser.getOrganizationId());
            lInsert.setLong(3, lUser.getId());
            lInsert.setString(4, lScreen);
            lInsert.setString(5, SCREENS.get(lScreen));
            lInsert.setString(6, lCriteria);
            lInsert.setString(7, lPayload);
            lInsert.setInt(8, lRows.length());
            lInsert.setQueryTimeout(ReportConstantJsf.QUERY_TIME_OUT_SECONDS);
            lInsert.executeUpdate();

            lSelect = con.prepareStatement("select fsslexpirydate from fnascreensharelink "
                    + "where fssltoken = ? and fsslorgid = ?");
            lSelect.setString(1, lToken);
            lSelect.setLong(2, lUser.getOrganizationId());
            lSelect.setQueryTimeout(ReportConstantJsf.QUERY_TIME_OUT_SECONDS);
            lRs = lSelect.executeQuery();
            Timestamp lExpiry = null;
            if (lRs.next()) {
                lExpiry = lRs.getTimestamp("fsslexpirydate");
            }
            con.commit();

            JSONObject lOut = new JSONObject();
            lOut.put("url", shareUrl(pRequest, lUser.getOrganizationId(), lToken));
            lOut.put("expiresAt", isoUtc(lExpiry));
            lOut.put("rowCount", lRows.length());
            writeJson(pResponse, 200, lOut);

            /* never log the token - it is the credential */
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_INFO,
                    "llmShare create org=" + lUser.getOrganizationId() + " user=" + lUser.getId()
                            + " screen=" + lScreen + " rows=" + lRows.length() + " ttl=" + lTtl);
        } catch (Exception e) {
            rollback(con);
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare create failed", e);
            writeJson(pResponse, 500, error("Could not create the link."));
        } finally {
            close(null, lRs, lSelect);
            close(null, null, lInsert);
            close(null, null, lCount);
            DBManager.CloseConnection(con);
        }
    }

    /* ---------------------------------------------------------------- SERVE */

    private void serve(HttpServletRequest pRequest, HttpServletResponse pResponse, String pToken) throws IOException {
        Matcher lMatcher = TOKEN_PATTERN.matcher(pToken);
        if (!lMatcher.matches()) {
            writeJson(pResponse, 404, error("Link not found."));
            return;
        }

        long lOrgId;
        try {
            lOrgId = Long.parseLong(lMatcher.group(1));
        } catch (NumberFormatException e) {
            writeJson(pResponse, 404, error("Link not found."));
            return;
        }

        Connection con = null;
        PreparedStatement lStatement = null;
        ResultSet lRs = null;
        try {
            con = DBManager.getOrganizationConnection(lOrgId);
            if (con == null) {
                writeJson(pResponse, 503, error("Database unavailable."));
                return;
            }

            /*
             * expiry enforced by the database clock; fsslorgid must match the token prefix
             */
            lStatement = con.prepareStatement("select fssltoken, fsslscreen, fsslscreenlabel, fsslcriteriainfo, "
                    + "fsslpayload, fsslrowcount, fsslcreateddate, fsslexpirydate from fnascreensharelink "
                    + "where fssltoken = ? and fsslorgid = ? and fsslrowstate > -1 and fsslexpirydate > now()");
            /* first dash only: the base64url half may also contain '-' */
            lStatement.setString(1, pToken.substring(pToken.indexOf('-') + 1));
            lStatement.setLong(2, lOrgId);
            lStatement.setQueryTimeout(ReportConstantJsf.QUERY_TIME_OUT_SECONDS);
            lRs = lStatement.executeQuery();

            if (!lRs.next()) {
                writeJson(pResponse, 410, error("This link has expired or was revoked."));
                return;
            }

            JSONObject lPayload = new JSONObject(lRs.getString("fsslpayload"));
            JSONArray lColumns = lPayload.optJSONArray("columns");
            JSONArray lRows = lPayload.optJSONArray("rows");

            if ("md".equalsIgnoreCase(pRequest.getParameter("format"))) {
                writeText(pResponse, markdown(lRs, lColumns, lRows));
                return;
            }

            JSONObject lOut = new JSONObject();
            lOut.put("screen", lRs.getString("fsslscreen"));
            lOut.put("screenLabel", lRs.getString("fsslscreenlabel"));
            lOut.put("criteria", criteriaObject(lRs.getString("fsslcriteriainfo")));
            lOut.put("generatedAt", isoUtc(lRs.getTimestamp("fsslcreateddate")));
            lOut.put("expiresAt", isoUtc(lRs.getTimestamp("fsslexpirydate")));
            lOut.put("rowCount", lRs.getInt("fsslrowcount"));
            lOut.put("columns", lColumns);
            lOut.put("rows", lRows);
            writeJson(pResponse, 200, lOut);
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare serve failed", e);
            writeJson(pResponse, 500, error("Could not read the link."));
        } finally {
            close(null, lRs, lStatement);
            DBManager.CloseConnection(con);
        }
    }

    /* --------------------------------------------------------------- REVOKE */

    private void revoke(HttpServletRequest pRequest, HttpServletResponse pResponse) throws IOException {
        IUser lUser = loggedInUser(pRequest);
        if (lUser == null) {
            writeJson(pResponse, 401, error("Login required."));
            return;
        }

        String lRevokeParam = pRequest.getParameter("revokeToken");
        /* first dash only: the base64url half may also contain '-' */
        int lSeparator = lRevokeParam.indexOf('-');
        if (lSeparator < 1) {
            writeJson(pResponse, 404, error("Link not found."));
            return;
        }

        Connection con = null;
        PreparedStatement lStatement = null;
        try {
            con = DBManager.getOrganizationConnectionForGSTScheduler(lUser.getOrganizationId());
            if (con == null) {
                writeJson(pResponse, 503, error("Database unavailable."));
                return;
            }

            /* only the creator can revoke */
            lStatement = con.prepareStatement("update fnascreensharelink set fsslrowstate = -1 "
                    + "where fssltoken = ? and fsslorgid = ? and fssluserid = ? and fsslrowstate > -1");
            lStatement.setString(1, lRevokeParam.substring(lSeparator + 1));
            lStatement.setLong(2, lUser.getOrganizationId());
            lStatement.setLong(3, lUser.getId());
            lStatement.setQueryTimeout(ReportConstantJsf.QUERY_TIME_OUT_SECONDS);
            int lUpdated = lStatement.executeUpdate();
            if (lUpdated > 0) {
                con.commit();
            } else {
                rollback(con);
            }

            JSONObject lOut = new JSONObject();
            lOut.put("revoked", lUpdated > 0);
            writeJson(pResponse, lUpdated > 0 ? 200 : 404, lOut);
        } catch (Exception e) {
            rollback(con);
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare revoke failed", e);
            writeJson(pResponse, 500, error("Could not revoke the link."));
        } finally {
            close(null, null, lStatement);
            DBManager.CloseConnection(con);
        }
    }

    /* -------------------------------------------------------------- HELPERS */

    private IUser loggedInUser(HttpServletRequest pRequest) {
        try {
            String lLoginKey = pRequest.getParameter("LK");
            if (!Utilities.hasValue(lLoginKey)) {
                return null;
            }
            return Applications.getInstance().getLoggedInUser(lLoginKey);
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare: user lookup failed", e);
            return null;
        }
    }

    private String readBody(HttpServletRequest pRequest) throws IOException {
        StringBuilder lBuilder = new StringBuilder();
        char[] lBuffer = new char[8192];
        BufferedReader lReader = pRequest.getReader();
        int lRead;
        while ((lRead = lReader.read(lBuffer)) > 0) {
            lBuilder.append(lBuffer, 0, lRead);
            if (lBuilder.length() > MAX_BODY_CHARS) {
                throw new IOException("request body too large");
            }
        }
        return lBuilder.toString();
    }

    private String newToken(long pOrgId) {
        byte[] lBytes = new byte[TOKEN_RANDOM_BYTES];
        RANDOM.nextBytes(lBytes);
        return pOrgId + "-" + Base64.getUrlEncoder().withoutPadding().encodeToString(lBytes);
    }

    private int clampTtl(int pTtl) {
        if (pTtl < MIN_TTL_MINUTES) {
            return MIN_TTL_MINUTES;
        }
        if (pTtl > MAX_TTL_MINUTES) {
            return MAX_TTL_MINUTES;
        }
        return pTtl;
    }

    /**
     * Adds label + type to each column so a consumer does not have to guess what a
     * value is.
     * Type is inferred from at most 50 non-empty values.
     */
    private JSONArray withTypes(JSONArray pColumns, JSONArray pRows) throws Exception {
        JSONArray lOut = new JSONArray();
        for (int i = 0; i < pColumns.length(); i++) {
            JSONObject lColumn = pColumns.optJSONObject(i);
            if (lColumn == null) {
                continue;
            }
            String lKey = lColumn.has("key") ? lColumn.getString("key") : "";
            if (!Utilities.hasValue(lKey)) {
                continue;
            }
            String lLabel = lColumn.has("label") ? lColumn.getString("label") : lKey.replace('_', ' ');

            JSONObject lTyped = new JSONObject();
            lTyped.put("key", lKey);
            lTyped.put("label", lLabel);
            lTyped.put("type", inferType(pRows, lKey));
            lOut.put(lTyped);
        }
        return lOut;
    }

    private String inferType(JSONArray pRows, String pKey) {
        int lSeen = 0;
        for (int i = 0; i < pRows.length() && lSeen < 50; i++) {
            JSONObject lRow = pRows.optJSONObject(i);
            if (lRow == null || !lRow.has(pKey)) {
                continue;
            }
            Object lValue = lRow.opt(pKey);
            if (lValue == null) {
                continue;
            }
            String lText = lValue.toString().trim();
            if (lText.length() == 0) {
                continue;
            }
            lSeen++;
            try {
                new BigDecimal(lText.replace(",", "").replace("%", ""));
            } catch (NumberFormatException e) {
                return "string";
            }
        }
        return lSeen == 0 ? "string" : "number";
    }

    private JSONObject criteriaObject(String pCriteria) {
        try {
            if (Utilities.hasValue(pCriteria)) {
                return new JSONObject(pCriteria);
            }
        } catch (Exception e) {
            /* legacy or unexpected criteria must not break the read path */
        }
        return new JSONObject();
    }

    private String markdown(ResultSet pRow, JSONArray pColumns, JSONArray pRows) throws Exception {
        StringBuilder lMd = new StringBuilder();
        lMd.append("# ").append(pRow.getString("fsslscreenlabel")).append("\n\n");
        lMd.append("- Generated: ").append(isoUtc(pRow.getTimestamp("fsslcreateddate"))).append("\n");
        lMd.append("- Expires: ").append(isoUtc(pRow.getTimestamp("fsslexpirydate"))).append("\n");
        lMd.append("- Rows: ").append(pRow.getInt("fsslrowcount")).append("\n");

        JSONObject lCriteria = criteriaObject(pRow.getString("fsslcriteriainfo"));
        if (lCriteria.length() > 0) {
            lMd.append("- Criteria: ");
            Iterator<?> lKeys = lCriteria.keys();
            boolean lFirst = true;
            while (lKeys.hasNext()) {
                String lKey = String.valueOf(lKeys.next());
                if (!lFirst) {
                    lMd.append(", ");
                }
                lMd.append(lKey).append("=").append(mdCell(lCriteria.opt(lKey)));
                lFirst = false;
            }
            lMd.append("\n");
        }

        int lLimit = pRows.length() > MD_MAX_ROWS ? MD_MAX_ROWS : pRows.length();
        if (lLimit < pRows.length()) {
            lMd.append("- Showing first ").append(lLimit).append(" of ").append(pRows.length())
                    .append(" rows; the JSON link has all of them.\n");
        }
        lMd.append("\n");

        for (int c = 0; c < pColumns.length(); c++) {
            JSONObject lColumn = pColumns.optJSONObject(c);
            lMd.append(c == 0 ? "| " : " | ").append(mdCell(lColumn == null ? null : lColumn.opt("label")));
        }
        lMd.append(" |\n");
        for (int c = 0; c < pColumns.length(); c++) {
            lMd.append(c == 0 ? "| ---" : " | ---");
        }
        lMd.append(" |\n");

        for (int r = 0; r < lLimit; r++) {
            JSONObject lRowData = pRows.optJSONObject(r);
            for (int c = 0; c < pColumns.length(); c++) {
                JSONObject lColumn = pColumns.optJSONObject(c);
                Object lValue = (lRowData == null || lColumn == null) ? null : lRowData.opt(lColumn.optString("key"));
                lMd.append(c == 0 ? "| " : " | ").append(mdCell(lValue));
            }
            lMd.append(" |\n");
        }
        return lMd.toString();
    }

    private String mdCell(Object pValue) {
        if (pValue == null) {
            return "";
        }
        String lText = pValue.toString().replace("\r", " ").replace("\n", " ").replace("|", "\\|").trim();
        if (lText.length() > 80) {
            return lText.substring(0, 77) + "...";
        }
        return lText;
    }

    private String shareUrl(HttpServletRequest pRequest, long pOrgId, String pToken) {
        String lBase = null;
        try {
            lBase = Applications.getInstance().getApplicationURL(pOrgId, FAConstants.FNA_APP_ID.longValue());
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare: base url failed", e);
        }
        if (!Utilities.hasValue(lBase)) {
            /* fallback only: a node-local host will not survive a load balancer */
            lBase = pRequest.getScheme() + "://" + pRequest.getServerName() + ":" + pRequest.getServerPort()
                    + pRequest.getContextPath();
        }
        while (lBase.endsWith("/")) {
            lBase = lBase.substring(0, lBase.length() - 1);
        }
        return lBase + "/LlmShare?t=" + pToken;
    }

    private String isoUtc(Timestamp pTimestamp) {
        if (pTimestamp == null) {
            return "";
        }
        return Instant.ofEpochMilli(pTimestamp.getTime()).toString();
    }

    private void writeJson(HttpServletResponse pResponse, int pStatus, JSONObject pBody) throws IOException {
        pResponse.setStatus(pStatus);
        pResponse.setContentType("application/json;charset=UTF-8");
        pResponse.setHeader("Cache-Control", "no-store");
        pResponse.setHeader("X-Content-Type-Options", "nosniff");
        pResponse.setHeader("X-Robots-Tag", "noindex");
        PrintWriter lOut = pResponse.getWriter();
        lOut.print(pBody.toString());
        lOut.flush();
    }

    private void writeText(HttpServletResponse pResponse, String pText) throws IOException {
        pResponse.setStatus(200);
        pResponse.setContentType("text/plain;charset=UTF-8");
        pResponse.setHeader("Cache-Control", "no-store");
        pResponse.setHeader("X-Content-Type-Options", "nosniff");
        pResponse.setHeader("X-Robots-Tag", "noindex");
        PrintWriter lOut = pResponse.getWriter();
        lOut.print(pText);
        lOut.flush();
    }

    private JSONObject error(String pMessage) {
        JSONObject lError = new JSONObject();
        try {
            lError.put("error", pMessage);
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare: error body failed", e);
        }
        return lError;
    }

    private void close(Connection pConnection, ResultSet pRs, PreparedStatement pStatement) {
        try {
            if (pRs != null) {
                pRs.close();
            }
            if (pStatement != null) {
                pStatement.close();
            }
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare: close failed", e);
        }
    }

    private void rollback(Connection pConnection) {
        try {
            if (pConnection != null) {
                pConnection.rollback();
            }
        } catch (Exception e) {
            LogManager.log(LlmShareServlet.class, LogManager.LOG_LEVEL_ERROR, "llmShare: rollback failed", e);
        }
    }}2. WebContent/WEB-INF/web.xml—

    add beside
    the other
    servlet declarations<servlet><servlet-name>LlmShare</servlet-name><servlet-class>com.tcs.report.reportApiServlet.LlmShareServlet</servlet-class></servlet><servlet-mapping><servlet-name>LlmShare</servlet-name><url-pattern>/LlmShare</url-pattern></servlet-mapping>
Do not add/LlmShare to RestrictActionsFilter,FnASecurityTokenFilter,
    CrossScriptingFilterAngular or DDRReportValidatorFilter.3.TFTPScripts/FinanceAccounting/TechProvision/FA_Tables.sql—
    append DROP
    TABLE IF
    EXISTS fnascreensharelink;
    CREATE TABLE`fnascreensharelink`(`fsslid`

    bigint(20) NOT NULL AUTO_INCREMENT,
  `fssltoken` varchar(80) NOT NULL,
  `fsslorgid` bigint(20) NOT NULL,
  `fssluserid` bigint(20) NOT NULL,
  `fsslscreen` varchar(100) NOT NULL,
  `fsslscreenlabel` varchar(200) NOT NULL,
  `fsslcriteriainfo` text,
  `fsslpayload` longtext NOT NULL,
  `fsslrowcount` int(11) NOT NULL,
  `fsslcreateddate` datetime NOT NULL,
  `fsslexpirydate` datetime NOT NULL,
  `fsslrowstate` bigint(20) NOT NULL DEFAULT 1,

  PRIMARY KEY (`fsslid`),
  UNIQUE KEY `uk_fssltoken` (`fssltoken`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
fssltoken holds up to 18 digits + '-' + 43 chars = 62, and the org id is also stored separately in fsslorgid so the read path can verify it.
4. WebContent/anglarCodeReports/src/app/ddrreporturl.ts
public llmShare = "/financeaccounting/LlmShare";
5. WebContent/anglarCodeReports/src/app/myapp-service.service.ts — next to getExportPdf (:1325)

public createLlmShare(payload: any): any {
  return this.http.post(this.ddrreporturl.llmShare, payload);
}
LK is appended by httperrorinterceptor.service.ts:60 already — no auth code here.
6. auto-payment-vouchers-report.component.ts — one method
shareWithLlm(ttlMinutes: number) {
  const rows = [];
  this.gridApi.forEachNodeAfterFilterAndSort((node) => rows.push(node.data));
  const payload = {
    screen: "autoPaymentReport.an",
    criteria: this.searchCriteria["exportSearchCriteria"],
    columns: this.ddrReportApiService.displayColumns(
      this.gridApi.columnModel.displayedColumns
    ),
    rows,
    ttlMinutes,
  };
  this.myappService.createLlmShare(payload).subscribe({
    next: (res: any) => {
      if (navigator.clipboard) navigator.clipboard.writeText(res.url);
      this.lSearchContentService.showerrormessage.next([
        {
          message: `Link copied. Expires ${new Date(
            res.expiresAt
          ).toLocaleString()}. Anyone with it can read ${res.rowCount} rows.`,
          action: "Info",
        },
      ]);
    },
    error: () => {
      this.lSearchContentService.showerrormessage.next([
        {
          message:
            "Could not create link. Narrow the search if the result is very large.",
          action: "Error",
        },
      ]);
    },
  });
}
7. auto-payment-vouchers-report.component.html — inside <mat-menu #menu="matMenu"> (:485)
<button mat-menu-item (click)="shareWithLlm(1440)">
  <span><i class="jsonIco"></i>Share with LLM (24h)</span>
</button>
Verification, in order
curl -i "https://<host>/financeaccounting/LlmShare"                      # 400
curl -i "https://<host>/financeaccounting/LlmShare?t=1-xxxx"             # 404
curl -i "https://<host>/financeaccounting/LlmShare?t=<real>"             # 200 JSON, no cookies
curl -i "https://<host>/financeaccounting/LlmShare?t=<real>&format=md"   # 200 text/plain
Create in the UI → paste the copied URL into a private window → expect JSON. Then wait past the

TTL (use ttlMinutes: 15 temporarily) → 410. Revoke → 410 immediately.
Skipped: per-org TTL setting, cleanup job, share-list page, HTML view, try-with-resources cleanup. Risk: two deployment unknowns remain — whether FWFilter/WebActivityMonitorFilter allow an anonymous GET (fallback: add /LlmShare to their exemption list), and whether getApplicationURL returns an absolute URL (if the first copied link is relative, the request-based fallback in shareUrl needs to run unconditionally). Also: the link is a bearer capability to financial data for its lifetime — the 24h default, the clipboard text naming row count, and revoke are the whole safety margin.

import com.tcs.utilities.I18NUtilities;
import java.text.SimpleDateFormat;
    import java.util.TimeZone;

private String formatTimestamp(Timestamp pTimestamp, long pOrgId) {
	if (pTimestamp == null) {
		return "";
	}
	TimeZone lTz = null;
	try {
		lTz = I18NUtilities.getOrgTimeZone(pOrgId);
	} catch (Exception e) {
		/* fallback if external org config fails */
	}
	if (lTz == null) {
		lTz = TimeZone.getDefault();
	}
	SimpleDateFormat lFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX");
	lFormat.setTimeZone(lTz);
	return lFormat.format(pTimestamp);
}

XXX produces
standard ISO-8601
with the org's

exact offset (e.g. 2026-10-29T15:30:00+05:30), so both LLMs and JavaScript parse it accurately.
2. Update the 3 call sites in LlmShareServlet.java

In create():
lOut.put("expiresAt", formatTimestamp(lExpiry, lUser.getOrganizationId()));

In serve():
lOut.put("generatedAt", formatTimestamp(lRs.getTimestamp("fsslcreateddate"), lOrgId));
lOut.put("expiresAt", formatTimestamp(lRs.getTimestamp("fsslexpirydate"), lOrgId));

In markdown():
Pass lOrgId

into markdown(ResultSet pRow, JSONArray pColumns, JSONArray pRows,
        long pOrgId):lMd.append("- Generated: ").append(formatTimestamp(pRow.getTimestamp("fsslcreateddate"),pOrgId)).append("\n");lMd.append("- Expires: ").append(formatTimestamp(pRow.getTimestamp("fsslexpirydate"),pOrgId)).append("\n")
;