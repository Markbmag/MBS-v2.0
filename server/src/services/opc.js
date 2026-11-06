// Чтение значения из ПЛК по OPC UA (фоновый опрос).
// Код перенесён из server.js без изменений.

// ================== OPC UA ЧТЕНИЕ ПЛК ==================
const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = require('node-opcua');

const OPC_ENDPOINT        = process.env.OPC_ENDPOINT || 'opc.tcp://10.203.46.10:4840';
const OPC_NODE_ID         = process.env.OPC_NODE_ID  || 'ns=3;s="IOT_设备交互数据"."Overhead Process Section"."PLC_TO_IOT"."备用"';
const OPC_POLL_INTERVAL   = parseInt(process.env.OPC_POLL_INTERVAL)   || 3000;
const OPC_MAX_READ_ERRORS = parseInt(process.env.OPC_MAX_READ_ERRORS) || 5;
const OPC_RECONNECT_DELAY = parseInt(process.env.OPC_RECONNECT_DELAY) || 5000;

// Общее состояние — отдаётся по HTTP
const opcState = {
  value: null,
  ts: null,
  error: null,
  connected: false,
};

async function startOpcPolling() {
  while (true) {
    let client = null;
    let session = null;

    try {
      console.log(`[OPC UA] Подключение к ${OPC_ENDPOINT}...`);

      client = OPCUAClient.create({
        endpointMustExist: false,
        securityMode: MessageSecurityMode.None,
        securityPolicy: SecurityPolicy.None,
        connectionStrategy: {
          initialDelay: 2000,
          maxRetry: 3,
          maxDelay: 5000,
        },
      });

      await client.connect(OPC_ENDPOINT);
      console.log('[OPC UA] Подключено');

      session = await client.createSession();
      console.log('[OPC UA] Сессия создана');

      opcState.connected = true;
      opcState.error = null;

      let readErrors = 0;

      while (true) {
        try {
          const dataValue = await session.readVariableValue(OPC_NODE_ID);
          opcState.value = dataValue.value.value;
          opcState.ts = Date.now();
          opcState.error = null;
          readErrors = 0;
          console.log(`[OPC UA] Значение: ${opcState.value}`);
        } catch (readErr) {
          readErrors++;
          console.error(
            `[OPC UA] Ошибка чтения (${readErrors}/${OPC_MAX_READ_ERRORS}):`,
            readErr.message
          );
          opcState.error = `read: ${readErr.message}`;

          // Если ошибки идут подряд — рвём цикл и переподключаемся
          if (readErrors >= OPC_MAX_READ_ERRORS) {
            console.error('[OPC UA] Слишком много ошибок чтения — переподключение');
            break;
          }
        }

        await new Promise((r) => setTimeout(r, OPC_POLL_INTERVAL));
      }
    } catch (connErr) {
      console.error('[OPC UA] Ошибка подключения:', connErr.message);
      opcState.error = `connect: ${connErr.message}`;
    } finally {
      opcState.connected = false;

      // ВАЖНО: сначала сессия, потом клиент
      try {
        if (session) await session.close();
      } catch (e) {
        // молча: сессия могла уже умереть вместе с соединением
      }
      try {
        if (client) await client.disconnect();
      } catch (e) {
        // молча
      }

      console.log(`[OPC UA] Отключено, повтор через ${OPC_RECONNECT_DELAY / 1000} с`);
      await new Promise((r) => setTimeout(r, OPC_RECONNECT_DELAY));
    }
  }
}

// Запускаем поллинг и ловим необработанные ошибки, чтобы не уронить процесс
startOpcPolling().catch((e) => {
  console.error('[OPC UA] Фатальная ошибка поллинга:', e);
});

module.exports = { opcState };
