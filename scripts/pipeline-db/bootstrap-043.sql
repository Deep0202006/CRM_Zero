-- Disposable historical fixtures created before the creation firewall exists.
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,area,created_at) values
('81000000-0000-4000-a000-000000000001','Pooja Medical & Prov. Stores','Pooja','9876543210','Retailer','Converted','10000000-0000-4000-a000-000000000001','Anand',now()-interval '3 years'),
('81000000-0000-4000-a000-000000000002','New Identity Medical','Person','9876543211','Retailer','New','10000000-0000-4000-a000-000000000001','Anand',now()-interval '2 years'),
('81000000-0000-4000-a000-000000000003','Contacted Identity Medical','Person','9876543212','Retailer','Contacted','10000000-0000-4000-a000-000000000001','Anand',now()-interval '1 year');
