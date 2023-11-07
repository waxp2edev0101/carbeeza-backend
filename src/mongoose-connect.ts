import mongoose from "mongoose";

let connection = null;

const connect = async function (dbName: string) {
	const uri = `${process.env.MONGODB_CONNECTION_STRING}/${dbName}?retryWrites=true&w=majority`;

	if (connection == null) {
		if (process.env.NODE_ENV === "dev") {
			mongoose.set("debug", true);
		}
		connection = mongoose
			.connect(uri, {
				serverSelectionTimeoutMS: 5000
			})
			.then(() => mongoose);

		// `await`ing connection after assigning to the `conn` variable
		// to avoid multiple function calls creating new connections
		await connection;
	} else {
		connection = mongoose.connection.useDb(dbName);
	}

	return connection;
};
export default connect;
