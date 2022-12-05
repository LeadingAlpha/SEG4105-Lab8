// This file is an inactive copy of what is published on the Cloud Code server, so changes made to
// this file will not have any effect locally. Changes to Cloud Code scripts are normally done directly in the
// Unity Dashboard.

const _ = require("lodash-4.17");
const { SettingsApi } = require("@unity-services/remote-config-1.1");
const { DataApi } = require("@unity-services/cloud-save-1.2");

const badRequestError = 400;
const tooManyRequestsError = 429;

// Entry point for the Cloud Code script
module.exports = async ({ params, context, logger }) => {
  try {
    let { projectId, playerId, accessToken, environmentId } = context;

    let { taskSelected, saveId } = params;

    // playerId = "uLG86SYDCYRA7Kf7VZjnHVLH2pJP";
    // const saveId = "b1f819c5-526e-47da-a5be-0c52b11d8491";

    const remoteConfigApi = new SettingsApi({ accessToken });
    const cloudSaveApi = new DataApi({ accessToken });

    const services = {
      projectId,
      playerId,
      environmentId,
      remoteConfigApi,
      cloudSaveApi,
      logger,
    };

    let saveData = await getSaveState(services, saveId);
    let taskDB = await getRemoteConfigData(services);

    // let taskSelected = {
    //   taskId: 1,
    //   option: {
    //     title: "test",
    //     attributes: {
    //       personal: 50,
    //       family: 50,
    //       community: 50,
    //       wealth: 50,
    //     },
    //   },
    // };


    // Mock data for debugging
    // saveData = {
    //   completedTasks: [],
    //   currentTasks: [],
    //   personalHappinessValue: 50,
    //   familyHappinessValue: 50,
    //   communityHappinessValue: 50,
    //   personalWealthValue: 50,
    //   personalHappinessMultiplier: 2.0,
    //   familyHappinessMultiplier: 2.0,
    //   communityHappinessMultiplier: 2.0,
    //   personalWealthMultiplier: 2.0,
    // };

    saveData.completedTasks.push(taskSelected.taskId);

    // using taskID remove this task from current tasks
    saveData.currentTasks = saveData.currentTasks.filter(
      (task) => task.id !== taskSelected.taskId
    );

    let {
      personalHappinessMultiplier,
      familyHappinessMultiplier,
      communityHappinessMultiplier,
      personalWealthMultiplier,
    } = saveData;

    let { personal, family, community, wealth } = taskSelected.option.attributes;

    // update the 4 core values using the option and multplyier
    saveData.personalHappinessValue = Math.floor(
      saveData.personalHappinessValue + personal * personalHappinessMultiplier
    );
    saveData.familyHappinessValue = Math.floor(
      saveData.familyHappinessValue + family * familyHappinessMultiplier
    );
    saveData.communityHappinessValue = Math.floor(
      saveData.communityHappinessValue +
      community * communityHappinessMultiplier
    );
    saveData.personalWealthValue = Math.floor(
      saveData.personalWealthValue + wealth * personalWealthMultiplier
    );

    //RefreshTaskStateResponse
    let eventState = {
      currentTasks: saveData.currentTasks,
      completedTasks: saveData.completedTasks,
      communityHappinessValue: saveData.communityHappinessValue,
      familyHappinessValue: saveData.familyHappinessValue,
      personalHappinessValue: saveData.personalHappinessValue,
      personalWealthValue: saveData.personalWealthValue,
    };

    // Save the state to cloud
    await writeSaveState(services, saveId, saveData);

    // Return the state to the client
    return eventState;
  } catch (error) {
    transformAndThrowCaughtError(error);
  }
};

async function getSaveState(services, saveId) {
  services.logger.info("saveId" + saveId);
  const results = await getCloudSaveResult(services, saveId);

  if (results) {
    return results;
  }

  return undefined;
}

async function getCloudSaveResult({ projectId, playerId, cloudSaveApi, logger },
  key
) {
  try {
    logger.info("key" + key);
    const response = await cloudSaveApi.getItems(projectId, playerId, [key]);
    logger.info("key" + key);
    if (
      response.data.results &&
      response.data.results.length > 0 &&
      response.data.results[0]
    ) {
      return response.data.results[0].value;
    }

    return undefined;
  } catch (error) {
    let errorMessage;

    if (error.response) {
      // If the error is from the Cloud Save server
      errorMessage = JSON.stringify({
        response: error.response.data,
        status: error.response.status,
        headers: error.response.headers,
      });
    } else {
      // If the error is from the script
      errorMessage = JSON.stringify(error.message);
    }

    logger.error(
      `Could not get the key ${key} in Cloud Save. Got error ${errorMessage}`
    );
    // Return an error to the game client
    throw Error(`An error occurred when getting the state with id: ${key}`);
  }
}

async function writeSaveState({ projectId, playerId, cloudSaveApi, logger },
  saveId,
  state
) {
  try {
    logger.info(state);
    await cloudSaveApi.setItem(projectId, playerId, {
      key: saveId,
      value: state,
    });
  } catch (error) {
    let errorMessage;

    if (error.response) {
      // If the error is from the Cloud Save server
      errorMessage = JSON.stringify({
        response: error.response.data,
        status: error.response.status,
        headers: error.response.headers,
      });
    } else {
      // If the error is from the script
      errorMessage = JSON.stringify(error.message);
    }

    logger.error(
      `Could not write to key ${saveId} in Cloud Save. Got error ${errorMessage}`
    );
    // Return an error to the game client
    throw Error(`An error occurred when writing state to id: ${saveId}`);
  }
}

async function getRemoteConfigData({
  projectId,
  environmentId,
  remoteConfigApi,
}) {
  const response = await remoteConfigApi.assignSettingsGet(
    projectId,
    environmentId,
    "settings",
    ["TASK_CONFIG"]
  );

  if (
    response.data.configs &&
    response.data.configs.settings &&
    response.data.configs.settings.TASK_CONFIG
  ) {
    return response.data.configs.settings.TASK_CONFIG;
  }
  throw new RemoteConfigKeyMissingError("Failed to get TASK_CONFIG.");
}

// Some form of this function appears in all Cloud Code scripts.
// Its purpose is to parse the errors thrown from the script into a standard exception object which can be stringified.
function transformAndThrowCaughtError(error) {
  let result = {
    status: 0,
    name: "",
    message: "",
    retryAfter: null,
    details: "",
  };

  if (error.response) {
    result.status = error.response.data.status ? error.response.data.status : 0;
    result.name = error.response.data.title ?
      error.response.data.title :
      "Unknown Error";
    result.message = error.response.data.detail ?
      error.response.data.detail :
      error.response.data;

    if (error.response.status === tooManyRequestsError) {
      result.retryAfter = error.response.headers["retry-after"];
    } else if (error.response.status === badRequestError) {
      let arr = [];

      _.forEach(error.response.data.errors, (error) => {
        arr = _.concat(arr, error.messages);
      });

      result.details = arr;
    }
  } else {
    result.name = error.name;
    result.message = error.message;
  }

  throw new Error(JSON.stringify(result));
}