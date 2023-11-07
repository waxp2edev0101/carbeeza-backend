import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import serverless from "serverless-http";
import connect from "./mongoose-connect";
import nodemailer, { TransportOptions } from "nodemailer";
import randomString from "random-string";
import bcrypt from "bcryptjs";
import moment from "moment";
import {
	ULOnboardingSchema,
	isValidEmail,
	isValidCountry,
	formatPhoneNumber,
	DealerType,
	LenderSchema,
	DealerGroupSchema,
	DealerSchema,
	DealerGroupType,
	AgentSchema
} from "./schema";

import _ from "lodash";

// Init API server
const app = express();
const port = process.env.BASE_PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(function (req, res, next) {
	let allowOrigin = process.env.BASE_GUI_URL;
	const origin = req.get("Origin") ? req.get("Origin") : "";
	if (process.env.NODE_ENV == "dev" && allowOrigin != origin) {
		if (
			origin.indexOf("carbeeza.vercel.app") >= 0 ||
			origin.indexOf("http://localhost:3000") >= 0
		) {
			allowOrigin = origin;
		}
	}
	res.setHeader("Access-Control-Allow-Origin", allowOrigin);
	next();
});

const ERROR_MSG_HEADING = "Hmm... There seems to be a problem.";
const ERROR_MSG_TRY_AGAIN = `Please try again later. If the problem persists, <a href='${process.env.SUPPORT_URL}' class='text-primary'>contact support</a>.`;
const ERROR_MSG_BAD_LINK = `It looks like you're using a badly formed link. Make sure you are visiting the full URL provided in your verification email.<br><br>If the problem persists, <a href='${process.env.SUPPORT_URL}' class='text-primary'>contact support</a>.`;
const ERROR_MSG_SUPPORT = `Please <a href='${process.env.SUPPORT_URL}' class='text-primary'>contact support</a>.`;

// MongoDD Connection Object
let connection = null;

// Handle requests to create a new dealer entry.
app.post("/new-dealer", async function (req, res) {
	debug("start /new-dealer");

	debug("start agent lookup");
	// Check if agent id exists
	if (req?.body?.agent_id && _.isString(req?.body?.agent_id)) {
		try {
			connection = await connect(process.env.MONGODB_AGENTS_DB);
			const AgentModel = connection.model(
				process.env.MONGODB_AGENTS_COLLECTION,
				AgentSchema,
				process.env.MONGODB_AGENTS_COLLECTION
			);
			const agent = await AgentModel.findOne({
				agent_id: req?.body?.agent_id
			});
			if (!agent) {
				return res.status(404).send({
					data: {
						message: "Invalid Agent ID"
					}
				});
			}
		} catch (error) {
			return res.status(500).send({
				data: {
					message: "Internal server error (db lookup)"
				}
			});
		}
	}
	debug("end agent lookup");

	// Pull out only the fields we care about, in case other stuff was sent.
	const newData = <DealerType>(
		_.pick(
			req.body,
			"dealership_name",
			"dealership_phone",
			"dealership_lead_email",
			"dealership_billing_email",
			"dealership_website",
			"dealership_additional_websites",
			"dealership_country",
			"dealer_group_domain",
			"contact_full_name",
			"contact_email",
			"contact_phone",
			"dealership_providers",
			"lead_option",
			"agent_id"
		)
	);

	debug("start bcrypt");
	// Generate verification key and salt it.
	const emailVerificationKey = randomString({ length: 32 });
	let emailVerificationHash: string;
	try {
		emailVerificationHash = await bcrypt.hash(emailVerificationKey, 10);
	} catch (error) {
		console.log(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (bcrypt)."
			}
		});
	}
	debug("end bcrypt");

	// Add server-side fields that we need.
	newData.ultralead_email = null; // Set this as Null so python script knows to grab this and create a custom email address.
	newData.created_at = new Date();
	newData.verified_at = new Date(0); // 0 because it's not verified yet.
	newData.updated_at = new Date();
	newData.email_verified = false;
	newData.email_verification = [
		{
			bcrypt: emailVerificationHash,
			expires_at: moment().add(24, "hours").toDate()
		}
	];

	// Make phone number formats consistent.
	newData.dealership_phone = formatPhoneNumber(newData.dealership_phone);
	newData.contact_phone = formatPhoneNumber(newData.contact_phone);

	// Check if email and website domains match
	const websiteDomain = new URL(newData.dealership_website).hostname.replace(
		"www.",
		""
	);
	const emailDomain = _.last(newData.contact_email.split("@"));
	if (websiteDomain !== emailDomain) {
		return res.status(400).send({
			data: {
				message: `Email and website domains must match. (${websiteDomain}, ${emailDomain})`
			}
		});
	}
	// Store the domain
	newData.dealership_domain = websiteDomain;

	debug("start confirm inventory domain");
	const inventoryCollection =
		newData.dealership_country == "US"
			? process.env.MONGODB_INVENTORY_COLLECTION_US
			: process.env.MONGODB_INVENTORY_COLLECTION_CA;
	// Check if domain exists in inventory data
	try {
		connection = await connect(process.env.MONGODB_INVENTORY_DB);
		const DealerModel = connection.model(
			inventoryCollection,
			DealerSchema,
			inventoryCollection
		);
		const dealer = await DealerModel.findOne({
			va_seller_domains: newData.dealership_domain
		});
		if (!dealer) {
			return res.status(400).send({
				data: {
					message: "Dealership Website must have inventory to claim."
				}
			});
		}
	} catch (error) {
		debug(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (inventory check)."
			}
		});
	}
	debug("end confirm inventory domain");

	debug("start mongoose");
	// Connect to MongoDB and init data model.
	let ULOnboardingModel;
	try {
		connection = await connect(process.env.MONGODB_DEALERS_DB);
		ULOnboardingModel = connection.model(
			process.env.MONGODB_DEALERS_COLLECTION,
			ULOnboardingSchema,
			process.env.MONGODB_DEALERS_COLLECTION
		);
	} catch (error) {
		return res.status(500).send({
			data: {
				message: "Internal server error (db connect)."
			}
		});
	}
	debug("end mongoose");

	debug("start validate schema");

	// Validate the new data object against the schema.
	try {
		await ULOnboardingModel.validate(newData, _.keys(newData));
	} catch (error) {
		return res.status(400).send({
			data: {
				message: "Field validation failed.",
				fields: _.keys(error.errors)
			}
		});
	}

	debug("end validate schema");

	debug("start domain lookup");
	// Check if domain already in use.
	try {
		const dealer = await ULOnboardingModel.findOne({
			dealership_domain: newData.dealership_domain
		});
		if (dealer) {
			return res.status(400).send({
				data: {
					message: "Dealership domain already exists in system."
				}
			});
		}
	} catch (error) {
		return res.status(500).send({
			data: {
				message: "Internal server error (db lookup)"
			}
		});
	}
	debug("end domain lookup");

	debug("start db save");
	// Load the new data into the model and save to database.
	const document = new ULOnboardingModel(newData);
	let newRecord: DealerType;
	try {
		newRecord = <DealerType>await document.save();
	} catch (error) {
		console.log(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (failed to store to DB)."
			}
		});
	}
	debug("end db save");

	debug("start email");
	// Send email verification email.
	try {
		const emailResponse = await sendVerificationEmail(
			newRecord.contact_email,
			newRecord.contact_full_name,
			emailVerificationKey
		);
		debug(emailResponse);
	} catch (error) {
		console.log(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (email)."
			}
		});
	}
	debug("end email");

	// Respond with Success
	return res.status(200).send({
		data: {
			message: "Success"
		}
	});
});

// Verify email address for emailed verification link.
app.get("/verify-email", async function (req, res) {
	// Validate encoded input.
	if (!req.query.data || !_.isString(req.query.data)) {
		return res
			.status(400)
			.send(buildPage(ERROR_MSG_HEADING + " (1)", ERROR_MSG_BAD_LINK));
	}

	// Decode and validate input fields from encoded query param.
	let email: string;
	let key: string;
	try {
		// Decode Base64 and parse serialized JSON.
		const verifyData = JSON.parse(atob(req.query.data));
		email = isValidEmail(verifyData?.email) ? verifyData?.email : undefined;
		key =
			verifyData?.key && _.isString(verifyData.key)
				? verifyData.key
				: undefined;

		if (!email || !key) {
			throw new Error("Invalid Request");
		}
	} catch (error) {
		return res
			.status(400)
			.send(buildPage(ERROR_MSG_HEADING + " (2)", ERROR_MSG_BAD_LINK));
	}

	// Connect to MongoDB and init data model.
	let ULOnboardingModel;
	try {
		connection = await connect(process.env.MONGODB_DEALERS_DB);
		ULOnboardingModel = connection.model(
			process.env.MONGODB_DEALERS_COLLECTION,
			ULOnboardingSchema,
			process.env.MONGODB_DEALERS_COLLECTION
		);
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (3)", ERROR_MSG_TRY_AGAIN));
	}

	// Find the record we need in MongoDB by email provided in request.
	let dealer: DealerType;
	try {
		dealer = await ULOnboardingModel.findOne({
			contact_email: email
		});
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (4)", ERROR_MSG_TRY_AGAIN));
	}

	// Dealer doesn't exist.
	if (!dealer) {
		return res
			.status(404)
			.send(buildPage(ERROR_MSG_HEADING + " (5)", ERROR_MSG_SUPPORT));
	}

	// Has the verification link expired?
	if (moment(dealer.email_verification[0].expires_at) < moment()) {
		return res
			.status(400)
			.send(
				buildPage(
					"Oops! Your link has expired.",
					`Click here to <a href="${
						process.env.BASE_URL
					}/resend-verification-email?data=${btoa(
						JSON.stringify({ email: email })
					)}" class='text-primary'>resend verification email</a>.<br><br>Make sure you click the link in the email within 24 hours. If the problem persists, <a href='${
						process.env.SUPPORT_URL
					}' class='text-primary'>contact support</a>.`
				)
			);
	}

	// Does the provided key match the salted version we have in the DB?
	try {
		const match = await bcrypt.compare(
			key,
			dealer.email_verification[0].bcrypt
		);
		if (!match) {
			return res
				.status(400)
				.send(buildPage(ERROR_MSG_HEADING + " (6)", ERROR_MSG_SUPPORT));
		}
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (7)", ERROR_MSG_TRY_AGAIN));
	}

	// Update the record saying we've verified the email.
	try {
		dealer = await ULOnboardingModel.findOneAndUpdate(
			{
				contact_email: email
			},
			{
				email_verification: [],
				email_verified: true,
				verified_at: new Date(),
				updated_at: new Date()
			}
		);
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (8)", ERROR_MSG_TRY_AGAIN));
	}
	// Respond with Success

	const stripeUrl = `${
		dealer.dealership_country == "US"
			? process.env.STRIPE_URL_US
			: process.env.STRIPE_URL_CA
	}?prefilled_email=${dealer.dealership_billing_email}`;

	return res.status(200).send(
		buildPage(
			"Thank You! Your email has been verified.",
			`To complete your account setup and start your free trial, add a payment method by clicking the button below.</p>
				<table border="0" cellspacing="0" cellpadding="0" style="margin-left: auto;margin-right: auto;">
				<tr>
					<td style="padding: 12px 18px 12px 18px; border-radius:5px; background-color: #FFD750;" align="center">
						<a rel="noopener" target="_blank" href="${stripeUrl}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; color: #826441; text-decoration: none; display: inline-block;">Activate Free Trial</a>
					</td>
				</tr>
			</table>
			<p>You will be brought to the check out page, where you can add a payment method for your new account. No charges will be processed during the trial period, and you can cancel anytime before it ends.`
		)
	);
});

// TODO REMOVE
app.get("/test", async function (req, res) {
	const emailResponse = await sendVerificationEmail(
		"jess.latimer@carbeeza.com",
		"TEST TEST",
		"123abc"
	);
	console.log(emailResponse);

	const stripeUrl = "";
	return res.status(200).send(
		buildPage(
			"Thank You! Your email has been verified.",
			`To complete your account setup and start your free trial, add a payment method by clicking the button below.</p>
				<table border="0" cellspacing="0" cellpadding="0" style="">
				<tr>
					<td style="padding: 12px 18px 12px 18px; border-radius:5px; background-color: #FFD750;" align="center">
						<a rel="noopener" target="_blank" href="${stripeUrl}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; color: #826441; text-decoration: none; display: inline-block;">Activate Free Trial</a>
					</td>
				</tr>
			</table>
			<p>You will be brought to the check out page, where you can add a payment method for your new account.</p><p>No charges will be processed during the trial period, and you can cancel anytime before it ends.`
		)
	);
});

// Resend the verification email, invalidate previous verification keys,.
app.get("/resend-verification-email", async function (req, res) {
	// Validate encoded input.
	if (!req.query.data || !_.isString(req.query.data)) {
		return res
			.status(400)
			.send(buildPage(ERROR_MSG_HEADING + " (2)", ERROR_MSG_BAD_LINK));
	}

	// Decode and validate input fields from encoded query param.
	let email: string;
	try {
		// Decode Base64 and parse serialized JSON.
		const verifyData = JSON.parse(atob(req.query.data));
		email = isValidEmail(verifyData?.email) ? verifyData?.email : undefined;
		if (!email) {
			throw new Error("Invalid Request");
		}
	} catch (error) {
		return res
			.status(400)
			.send(buildPage(ERROR_MSG_HEADING + " (2)", ERROR_MSG_BAD_LINK));
	}

	// Generate verification key and salt it.
	const emailVerificationKey = randomString({ length: 32 });
	let emailVerificationHash: string;
	try {
		emailVerificationHash = await bcrypt.hash(emailVerificationKey, 10);
	} catch (error) {
		console.log(error);
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (11)", ERROR_MSG_TRY_AGAIN));
	}

	// Connect to MongoDB and init data model.
	let ULOnboardingModel;
	try {
		connection = await connect(process.env.MONGODB_DEALERS_DB);
		ULOnboardingModel = connection.model(
			process.env.MONGODB_DEALERS_COLLECTION,
			ULOnboardingSchema,
			process.env.MONGODB_DEALERS_COLLECTION
		);
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (12)", ERROR_MSG_TRY_AGAIN));
	}

	// Find the record we want to work with.
	let dealer: DealerType;
	try {
		dealer = await ULOnboardingModel.findOne({
			contact_email: email
		});
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (13)", ERROR_MSG_TRY_AGAIN));
	}

	// Dealer doesn't exist.
	if (!dealer) {
		return res
			.status(404)
			.send(buildPage(ERROR_MSG_HEADING + " (14)", ERROR_MSG_TRY_AGAIN));
	}

	// Don't need to resent link if we're already verified.
	if (dealer.email_verified) {
		return res
			.status(400)
			.send(
				buildPage(
					"Oops! You're already verified.",
					`Looks like this email address was already verified. If you think this is a mistake, please <a href='${process.env.SUPPORT_URL}' class='text-primary'>contact support</a>.`
				)
			);
	}

	// Invalidate and replace any existing verification fields, and reset a couple other fields for good measure.
	try {
		dealer = await ULOnboardingModel.findOneAndUpdate(
			{
				contact_email: email
			},
			{
				email_verification: [
					{
						bcrypt: emailVerificationHash,
						expires_at: moment().add(24, "hours").toDate()
					}
				],
				email_verified: false,
				verified_at: new Date(0),
				updated_at: new Date()
			}
		);
	} catch (error) {
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (15)", ERROR_MSG_TRY_AGAIN));
	}

	// Send the email verification email (again!)
	try {
		const emailResponse = await sendVerificationEmail(
			email,
			dealer.contact_full_name,
			emailVerificationKey
		);
		debug(emailResponse);
	} catch (error) {
		console.log(error);
		return res
			.status(500)
			.send(buildPage(ERROR_MSG_HEADING + " (16)", ERROR_MSG_TRY_AGAIN));
	}

	// Respond with Success
	return res
		.status(200)
		.send(
			buildPage(
				"Verification Email Resent",
				`We've sent a new verification email to your email address originally provided during sign-up. Make sure to click the link in the email within 24 hours. Any previous verification emails will no longer work.<br><br>If you think you may have provided the wrong email address, or have any other issues, please <a href='${process.env.SUPPORT_URL}' class='text-primary'>contact support</a>.`
			)
		);
});

// Handle requests to create a new dealer group entry.
app.post("/new-dealer-group", async function (req, res) {
	debug("start /new-dealer-group");

	debug("start mongoose");

	// Connect to MongoDB and init data model.
	let DealerGroupModel;
	try {
		connection = await connect(process.env.MONGODB_GROUPS_DB);
		DealerGroupModel = connection.model(
			process.env.MONGODB_GROUPS_COLLECTION,
			DealerGroupSchema,
			process.env.MONGODB_GROUPS_COLLECTION
		);
	} catch (error) {
		debug(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (db connect)."
			}
		});
	}

	debug("end mongoose");

	// Pull out only the fields we care about, in case other stuff was sent.
	const newData = <DealerGroupType>_.pick(
		req.body,
		"dealer_group_name",
		"dealer_group_website"
		// "dealer_group_country"
	);

	// Add server-side fields that we need.
	newData.type = "dealer_group";
	newData.created_at = new Date();
	newData.user_created = true;

	debug("start validate schema");

	// Validate the new data object against the schema.
	try {
		await DealerGroupModel.validate(newData, _.keys(newData));
	} catch (error) {
		return res.status(400).send({
			data: {
				message: "Field validation failed.",
				fields: _.keys(error.errors)
			}
		});
	}

	debug("end validate schema");

	// Store the domain
	newData.dealer_group_website = new URL(
		newData.dealer_group_website
	).hostname.replace("www.", "");

	debug("start domain lookup");
	// Check if domain already in use.
	try {
		const dealerGroup = await DealerGroupModel.findOne({
			dealer_group_website: newData.dealer_group_website
		});
		if (dealerGroup) {
			return res.status(400).send({
				data: {
					message: "Dealer group domain already exists in system."
				}
			});
		}
	} catch (error) {
		return res.status(500).send({
			data: {
				message: "Internal server error (db lookup)"
			}
		});
	}
	debug("end domain lookup");

	debug("start db save");
	// Load the new data into the model and save to database.
	const document = new DealerGroupModel(newData);
	let newRecord: DealerGroupType;
	try {
		newRecord = <DealerGroupType>await document.save();
		debug(newRecord);
	} catch (error) {
		console.log(error);
		return res.status(500).send({
			data: {
				//message: "Internal server error (failed to store to DB)."
				message: error
			}
		});
	}
	debug("end db save");

	// Respond with Success
	return res.status(200).send({
		data: {
			message: "Success"
		}
	});
});

// Endpoint for lender auto-complete
app.get("/search-lenders", async function (req, res) {
	// Validate encoded input.
	if (!req.query.query || !_.isString(req.query.query)) {
		return res.status(400).send({
			data: {
				message: "Bad request, missing data."
			}
		});
	}

	let LenderModel = null;
	try {
		connection = await connect(process.env.MONGODB_LENDERS_DB);
		LenderModel = connection.model(
			process.env.MONGODB_LENDER_COLLECTION,
			LenderSchema,
			process.env.MONGODB_LENDER_COLLECTION
		);
	} catch (error) {
		debug(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (db connect)."
			}
		});
	}

	try {
		const result = await LenderModel.aggregate([
			{
				$search: {
					index: "lender_search",
					autocomplete: {
						query: `${req.query.query}`,
						path: "name",
						fuzzy: {
							maxEdits: 2,
							prefixLength: 2,
							maxExpansions: 2
						}
					}
				}
			},
			{
				$project: {
					code: 1,
					name: 1
				}
			},
			{
				$limit: 10
			}
		]);
		return res.send(result);
	} catch (error) {
		return res.status(500).send({ message: error.message });
	}
});

// Endpoint for dealer group auto-complete
app.get("/search-dealer-groups", async function (req, res) {
	// Validate encoded input.
	if (!req.query.query || !_.isString(req.query.query)) {
		return res.status(400).send({
			data: {
				message: "Bad request, missing data."
			}
		});
	}

	let GroupModel = null;
	try {
		connection = await connect(process.env.MONGODB_GROUPS_DB);
		GroupModel = connection.model(
			process.env.MONGODB_GROUPS_COLLECTION,
			DealerGroupSchema,
			process.env.MONGODB_GROUPS_COLLECTION
		);
	} catch (error) {
		debug(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (db connect)."
			}
		});
	}

	try {
		const result = await GroupModel.aggregate([
			{
				$search: {
					index: "group_search",
					autocomplete: {
						query: `${req.query.query}`,
						path: "dealer_group_name",
						fuzzy: {
							maxEdits: 2,
							prefixLength: 2,
							maxExpansions: 2
						}
					}
				}
			},
			{
				$project: {
					dealer_group_name: 1,
					dealer_group_website: 1
				}
			},
			{
				$limit: 10
			}
		]);
		return res.send(result);
	} catch (error) {
		return res.status(500).send({ message: error.message });
	}
});

// Endpoint for existing dealer auto-complete
app.get("/search-dealers", async function (req, res) {
	// Validate encoded input.
	if (
		!req.query.query ||
		!_.isString(req.query.query) ||
		!isValidCountry(<string>req.query.country)
	) {
		return res.status(400).send({
			data: {
				message: "Bad request, missing data."
			}
		});
	}

	let DealerModel = null;
	const inventoryCollection =
		req.query.country == "US"
			? process.env.MONGODB_INVENTORY_COLLECTION_US
			: process.env.MONGODB_INVENTORY_COLLECTION_CA;
	try {
		connection = await connect(process.env.MONGODB_INVENTORY_DB);
		DealerModel = connection.model(
			inventoryCollection,
			DealerSchema,
			inventoryCollection
		);
	} catch (error) {
		debug(error);
		return res.status(500).send({
			data: {
				message: "Internal server error (db connect)."
			}
		});
	}

	try {
		// console.log(await DealerModel.countDocuments({}));
		const result = await DealerModel.aggregate([
			{
				$search: {
					index: "inventory_search",
					autocomplete: {
						query: `${req.query.query}`,
						path: "va_seller_domains",
						fuzzy: {
							maxEdits: 2,
							prefixLength: 2,
							maxExpansions: 2
						}
					}
				}
			},
			{
				$group: {
					_id: {
						va_seller_name: "$va_seller_name",
						va_seller_address: "$va_seller_address",
						va_seller_city: "$va_seller_city",
						va_seller_county: "$va_seller_county",
						va_seller_state: "$va_seller_state",
						va_seller_country: "$va_seller_country",
						va_seller_zip: "$va_seller_zip",
						va_seller_websites: "$va_seller_websites",
						va_seller_domains: "$va_seller_domains",
						va_seller_phones: "$va_seller_phones",
						va_seller_type: "$va_seller_type",
						va_seller_makes: "$va_seller_makes"
					}
				}
			},
			{
				$limit: 10
			}
		]);

		// Connect to MongoDB and init data model.
		let ULOnboardingModel;
		try {
			connection = await connect(process.env.MONGODB_DEALERS_DB);
			ULOnboardingModel = connection.model(
				process.env.MONGODB_DEALERS_COLLECTION,
				ULOnboardingSchema,
				process.env.MONGODB_DEALERS_COLLECTION
			);
		} catch (error) {
			return res.status(500).send({
				data: {
					message: "Internal server error (db connect)."
				}
			});
		}

		// We want to send back a param called onboarded with a true / false as to whether that dealer has been onboarded already or not.
		const dealers = await ULOnboardingModel.aggregate([
			{
				$group: {
					_id: {
						dealership_name: "$dealership_name"
					}
				}
			}
		]);
		result.forEach((item) => {
			item["_id"]["onboarded"] = false;

			dealers.forEach((dealer) => {
				if (
					dealer["_id"]["dealership_name"] ==
						item["_id"]["va_seller_name"] &&
					item["_id"]["va_seller_name"].indexOf("Carbeeza") < 0 // for testing
				) {
					item["_id"]["onboarded"] = true;
				}
			});
		});

		return res.send(result);
	} catch (error) {
		return res.status(500).send({ message: error.message });
	}
});

if (process.env.SERVERLESS === "0") {
	app.listen(port, () => {
		console.log(`API Listening at ${port}`);
	});
}

module.exports.handler = serverless(app);

const sendVerificationEmail = async function (
	email: string,
	contact_name: string,
	verificationKey: string
) {
	// Connect to SMTP Server
	const transporter = nodemailer.createTransport(<TransportOptions>{
		host: process.env.SMTP_HOST,
		port: process.env.SMTP_PORT,
		secure: false, // false for TLS
		auth: {
			user: process.env.SMTP_USER,
			pass: process.env.SMTP_PASS
		},
		tls: {
			ciphers: "SSLv3"
		}
	});

	// Build verification URL to send out. Serialize JSON and encode to Base64.
	const urlData = {
		email: email,
		key: verificationKey
	};
	const verificationUrl = `${process.env.BASE_URL}/verify-email?data=${btoa(
		JSON.stringify(urlData)
	)}`;
	const resendUrl = `${
		process.env.BASE_URL
	}/resend-verification-email?data=${btoa(JSON.stringify({ email: email }))}`;

	// Send the verification email.
	return await transporter.sendMail({
		from: `Ultralead AI <${process.env.SMTP_USER}>`,
		to: email,
		subject: "Please Verify Your Email",
		text: `
Welcome to Carbeeza, ${contact_name}!

There are a few items to take care of before we get started. 
Here's what you need to do:

1. Verify Your Email: Go to the URL below to verify your account.
2. Activate Free Trial: Once your email is verified, you can proceed to the checkout page to add a payment method and activate your free trial. We will also send you an email with the checkout link if you'd like to come back and do this later.

${verificationUrl}

If you did not request this account, you can safely ignore this message.
Please note this validation link is valid for 24 hours. In the event the link has expired, please go to: ${resendUrl}

Need help? Contact support: ${process.env.SUPPORT_URL}

--
Carbeeza Inc. 10180 101 St NW Suite 620, Edmonton, AB T5J 3S4
`,
		html: `
<html>
	<body style="font-family: Arial, Helvetica, sans-serif;padding: 20px;">
		<p>
		<img src="https://onboarding.ultralead.ai/logo.png" />
		</p>
		<p style="padding-top: 30px;">Welcome to Carbeeza, ${contact_name}!</p>
		<p>There are a few items to take care of before we get started. 
		<br />
		Here's what you need to do:</p>
		<p><ol>
			<li>Verify Your Email: Click the button below to verify your account.</li>
			<li>Activate Free Trial: Once your email is verified, you can proceed to the checkout page to add a payment method and activate your free trial. We will also send you an email with the checkout link if you'd like to come back and do this later.</li>
		</ol></p>
		<p style="text-align: center;">

		<table border="0" cellspacing="0" cellpadding="0" style="margin-left: auto;margin-right: auto;">
			<tr>
				<td style="padding: 12px 18px 12px 18px; border-radius:5px; background-color: #FFD750;" align="center">
					<a rel="noopener" target="_blank" href="${verificationUrl}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; color: #826441; text-decoration: none; display: inline-block;">Verify Your Email</a>
				</td>
			</tr>
		</table>
		</p>
		<p>
			If you did not request this account, you can safely ignore this message. 
			<br />
			Please note this validation link is valid for 24 hours. In the event the link has expired, <a href="${resendUrl}">click here to resend verification email</a>.
		</p>
		<p>Need help? <a href="${process.env.SUPPORT_URL}">Contact support</a>.</p>
		<hr style="margin-top: 50px;"/>
		<p>Carbeeza Inc. 10180 101 St NW Suite 620, Edmonton, AB T5J 3S4</p>
	</body>
</html>
`
	});
};

const buildPage = function (heading: string, body: string) {
	return `<html>
<body style="font-family: Arial, Helvetica, sans-serif;">
	<p>
	<img src="https://onboarding.ultralead.ai/logo.png" />
	</p>
	<div style="padding-left: 20px;padding-right: 20px;">
	<h1>${heading}</h1>
	<p>${body}</p>
	</div>
</body>
</html>`;
};

const debug = function (data) {
	if (process.env.NODE_ENV === "dev") {
		console.log(data);
	}
};
