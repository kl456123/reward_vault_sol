import { AnchorError, ProgramError } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { expect, assert } from "chai";

export async function checkError(promise, errorCode: number, errorMsg: string) {
  try {
    await promise;
    expect(true).to.be.false;
  } catch (_err) {
    if (_err instanceof AnchorError) {
      const err: AnchorError = _err;
      expect(err.error.errorCode.number).to.eq(errorCode);
      expect(err.error.errorMessage).to.eq(errorMsg);
    } else if (_err instanceof ProgramError) {
      const err: ProgramError = _err;
      expect(err.code).to.eq(errorCode);
      expect(err.msg).to.eq(errorMsg);
    } else {
      // console.log(_err);
    }
  }
}


export const withLogTest = async (callback, expectedLogs) => {
  let logTestOk = false;
  const listener = anchor.getProvider().connection.onLogs(
    "all",
    (logs) => {
      const index = logs.logs.findIndex(
        (logLine) => logLine === expectedLogs[0]
      );
      if (index === -1) {
        console.log("Expected: ");
        console.log(expectedLogs);
        console.log("Actual: ");
        console.log(logs);
      } else {
        const actualLogs = logs.logs.slice(index, index + expectedLogs.length);
        for (let i = 0; i < expectedLogs.length; i++) {
          if (actualLogs[i] !== expectedLogs[i]) {
            console.log("Expected: ");
            console.log(expectedLogs);
            console.log("Actual: ");
            console.log(logs);
            return;
          }
        }
        logTestOk = true;
      }
    },
    "recent"
  );
  try {
    await callback();
  } catch (err) {
    anchor.getProvider().connection.removeOnLogsListener(listener);
    throw err;
  }
  anchor.getProvider().connection.removeOnLogsListener(listener);
  assert.isTrue(logTestOk);
};
