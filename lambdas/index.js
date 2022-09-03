const {
    CognitoIdentityProviderClient,
    AdminAddUserToGroupCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({});

exports.addUserToReaderGroup = async function (event, context) {
    const { userPoolId, userName } = event;

    const command = new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userName,
        GroupName: "reader",
    });

    await client.send(command);
    context.succeed(event);
};

exports.read = async (event, context) => ({
    body: "I read something",
    statusCode: 200,
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
    },
});

exports.write = async (event, context) => ({
    body: "I got something to write: " + event.body,
    statusCode: 200,
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
    },
});
