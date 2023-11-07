import mongoose, { Types } from "mongoose";

// Some helper functions for data validation.
export const isValidEmail = (email: string) => {
	return /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(
		email
	);
};
export const isValidUrl = (url: string) => {
	return /^(http(s):\/\/.)[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)$/.test(
		url
	);
};
export const isValidPhone = (phone: string) => {
	return /\d{3}-\d{3}-\d{4}/.test(phone);
};
export const isValidCountry = (country: string) => {
	return country === "CA" || country === "US";
};

const formatSinglePhoneNumber = (input: string) => {
	//Filter only numbers from the input
	let cleaned = ("" + input).replace(/\D/g, "");

	if (cleaned.length === 11 && cleaned.charAt(0) === "1") {
		cleaned = cleaned.substring(1);
	}

	//Check if the input is of correct length
	const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);

	if (match) {
		return `${match[1]}-${match[2]}-${match[3]}`;
	}

	return null;
};

export const formatPhoneNumber = (input: string) => {
	// Allow comma-separated phone
	if (input.indexOf(",") >= 0) {
		const parts = input.split(",");
		const formattedParts = [];
		parts.forEach((part) => {
			formattedParts.push(formatSinglePhoneNumber(part));
		});
		return formattedParts.join(",");
	}
	return formatSinglePhoneNumber(input);
};

// Define TypeScript interfaces for schema
interface EmailVerificationType {
	bcrypt: string;
	expires_at: Date;
}

export interface DealerType {
	_id?: Types.ObjectId;
	dealership_name?: string;
	dealership_phone?: string;
	dealership_lead_email?: string;
	dealership_billing_email?: string;
	dealership_website?: string;
	dealership_additional_websites?: string;
	dealership_domain?: string;
	dealership_country?: string;
	dealer_group_domain?: string;
	contact_full_name?: string;
	contact_email?: string;
	contact_phone?: string;
	dealership_providers?: Array<string>;
	lead_option?: string;
	agent_id?: string;
	ultralead_email?: string;
	created_at?: Date;
	verified_at?: Date;
	updated_at?: Date;
	email_verified?: boolean;
	email_verification?: Array<EmailVerificationType>;
}

// Define document schema with field validation
const Schema = mongoose.Schema;
const EmailValidator = {
	type: String,
	validate: {
		validator: function (val: string) {
			return isValidEmail(val);
		},
		message: "Please enter a valid email."
	},
	required: [true, "Email address required."]
};
const EmailValidator_multi = {
	type: String,
	validate: {
		validator: function (val: string) {
			// Allow comma-separated emails
			if (val.indexOf(",") >= 0) {
				const parts = val.split(",");
				let isValid = true;
				parts.forEach((part) => {
					isValid = isValid && isValidEmail(part);
				});
				return isValid;
			}
			return isValidEmail(val);
		},
		message: "Please enter a valid email."
	},
	required: [true, "Email address required."]
};
const PhoneValidator = {
	type: String,
	validate: {
		validator: function (val: string) {
			// Allow comma-separated phone
			if (val.indexOf(",") >= 0) {
				const parts = val.split(",");
				let isValid = true;
				parts.forEach((part) => {
					isValid = isValid && isValidPhone(part);
				});
				return isValid;
			}
			return isValidPhone(val);
		},
		message: "Please enter a valid phone number."
	},
	required: [true, "Phone number required."]
};

export const ULOnboardingSchema = new Schema({
	dealership_name: {
		type: String,
		required: [true, "Dealership Name required."]
	},
	dealership_phone: PhoneValidator,
	dealership_lead_email: EmailValidator_multi,
	dealership_billing_email: EmailValidator_multi,
	dealership_website: {
		type: String,
		validate: {
			validator: function (val: string) {
				return val.indexOf(",") < 0 && isValidUrl(val);
			},
			message: "Please enter a valid website URL."
		},
		required: [true, "Website URL required."]
	},
	dealership_additional_websites: {
		type: String,
		validate: {
			validator: function (val: string) {
				// Allow comma-separated websites
				if (val.indexOf(",") >= 0) {
					const parts = val.split(",");
					let isValid = true;
					parts.forEach((part) => {
						isValid = isValid && isValidUrl(part);
					});
					return isValid;
				}
				return isValidUrl(val);
			},
			message: "Please enter a valid website URL."
		}
	},
	dealership_domain: { type: String, required: true },
	dealership_country: {
		type: String,
		validate: {
			validator: isValidCountry,
			message: "Please enter either US or CA for country."
		},
		required: [true, "Country required."]
	},
	dealer_group_domain: String,
	contact_full_name: {
		type: String,
		required: [true, "Contact name required."]
	},
	contact_email: EmailValidator,
	contact_phone: PhoneValidator,
	dealership_providers: [String],
	lead_option: String,
	agent_id: String,
	ultralead_email: String,
	created_at: { type: Date, required: true },
	verified_at: { type: Date, required: true },
	updated_at: { type: Date, required: true },
	email_verified: { type: Boolean, required: true },
	email_verification: [
		{
			bcrypt: String,
			expires_at: Date
		}
	]
});

export interface LenderType {
	_id?: Types.ObjectId;
	code?: string;
	name?: string;
	country?: string;
	filenames?: Array<string>;
	mapping?: Array<string>;
	updated_at?: Date;
	created_at?: Date;
}

export const LenderSchema = new Schema({
	code: String,
	name: String,
	country: String,
	filenames: [String],
	mapping: [String],
	updated_at: Date,
	created_at: Date
});

export interface DealerGroupType {
	_id?: Types.ObjectId;
	type?: string;
	dealer_group_name?: string;
	dealer_group_website?: string;
	dealer_group_country?: string;
	user_created?: boolean;
	created_at?: Date;
}

export const DealerGroupSchema = new Schema({
	type: String,
	dealer_group_name: { type: String, required: true },
	dealer_group_website: { type: String, required: true },
	dealer_group_country: {
		type: String,
		validate: {
			validator: function (val: string) {
				return val === "US" || val === "CA";
			},
			message: "Please enter either US or CA for country."
		}
		// required: [true, "Country required."]
	},
	user_created: Boolean,
	created_at: Date
});

export const DealerSchema = new Schema({
	id: String,
	vin: String,
	vid_stock: String,
	date_min: String,
	date_max: String,
	days_total: Number,
	listing_stock: String,
	listing_price: String,
	listing_type: String,
	listing_mileage: String,
	vehicle_year: String,
	vehicle_make: String,
	vehicle_model: String,
	vehicle_trim: String,
	vehicle_color_exterior: String,
	vehicle_color_interior: String,
	listing_vdp_url: String,
	vehicle_dealer_attribution_score: String,
	vehicle_dealer_attribution_level: String,
	listing_description: String,
	listing_features: String,
	vehicle_title: String,
	vehicle_type: String,
	vehicle_engine: String,
	vehicle_transmission: String,
	vehicle_transmission_type: String,
	vehicle_drivetrain: String,
	vehicle_doors: String,
	vehicle_fuel_type: String,
	vehicle_fuel_efficiency: String,
	vehicle_fuel_efficiency_highway: String,
	vehicle_fuel_efficiency_city: String,
	vehicle_trim_id: String,
	va_seller_id: String,
	va_seller_name: String,
	va_seller_address: String,
	va_seller_city: String,
	va_seller_county: String,
	va_seller_state: String,
	va_seller_zip: String,
	va_seller_country: String,
	va_seller_websites: String,
	va_seller_domains: String,
	va_seller_phones: String,
	va_seller_type: String,
	va_seller_makes: String,
	va_seller_latitude: String,
	va_seller_longitude: String,
	imgset_urls: String,
	photo_urls: String,
	certified_preowned_flag: String,
	vehicle_engine_cylinders: String,
	vehicle_engine_size: String,
	vehicle_style: String,
	vehicle_subtitle: String,
	vehicle_transmission_speed: String,
	vehicle_truck_bed_style: String,
	vehicle_truck_cab_style: String,
	location: {
		type: String,
		coordinates: [Number]
	}
});

export const AgentSchema = new Schema({
	agent_id: String,
	agency: String,
	first_name: String,
	last_name: String,
	email: String,
	phone: String,
	disabled_at: String,
	created_at: String,
	updated_at: String
});
